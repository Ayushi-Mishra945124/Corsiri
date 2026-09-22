using Corsiri.Companion.Infrastructure;
using Corsiri.Companion.Models;
using Corsiri.Companion.Services;
using Corsiri.Companion.Views;
using System.Globalization;
using System.Windows;

namespace Corsiri.Companion.Controllers;

public sealed class TriggerController : IDisposable
{
    private const int MaxUndoHistory = 12;
    private const string AiSuggestPrefix = "... (AI Suggest: ";
    private const string CustomVoiceCommandOption = "Custom Voice Command";
    private static readonly HashSet<string> AutoReplaceActions = new(StringComparer.OrdinalIgnoreCase)
    {
        "rewrite",
        "rewrite_structured",
        "translate",
        "polish_email",
        "improve_code",
        "debug_code",
        "optimize_code"
    };

    private readonly CursorTracker _cursorTracker;
    private readonly SelectionDetector _selectionDetector;
    private readonly OrbOverlayWindow _orbOverlayWindow;
    private readonly ResultPanelWindow _resultPanelWindow;
    private readonly ClipboardService _clipboardService;
    private readonly NovaClient _NovaClient;
    private readonly BrowserAutomationClient _browserAutomationClient;
    private readonly ExtensionAutomationClient _extensionAutomationClient;
    private readonly ActiveBrowserAutomationService _activeBrowserAutomationService;
    private readonly LassoSelectionService _lassoSelectionService;
    private readonly ScreenCaptureService _screenCaptureService;
    private readonly VoiceCommandPromptService _voiceCommandPromptService;
    private readonly WindowFocusTracker _windowFocusTracker;
    private readonly IntentMemoryService _intentMemoryService;
    private readonly SemaphoreSlim _runLock = new(1, 1);
    private readonly Stack<UndoHistoryEntry> _undoHistory = new();
    private readonly string[] _actions = ["Summarize", "Rewrite", "Translate", "Explain", "Bullet Points"];
    private int _selectedActionIndex;
    private IntPtr _lastExternalWindow = IntPtr.Zero;
    private string _lastResult = string.Empty;
    private CapturedSelectionContext? _lastSelectionContext;
    private InteractionMode _interactionMode;
    private readonly bool _autoReplaceEnabled;
    private readonly double _autoReplaceConfidenceThreshold;
    private readonly bool _managedBrowserFallbackEnabled;
    private readonly bool _textVisualContextEnabled;
    private readonly int _textVisualContextWidth;
    private readonly int _textVisualContextHeight;
    private readonly CorsiriFloatingPopup? _floatingPopup;
    private readonly ChatbotWindow? _chatbotWindow;

    public TriggerController(
        CursorTracker cursorTracker,
        SelectionDetector selectionDetector,
        OrbOverlayWindow orbOverlayWindow,
        ResultPanelWindow resultPanelWindow,
        ClipboardService clipboardService,
        NovaClient NovaClient,
        BrowserAutomationClient browserAutomationClient,
        ExtensionAutomationClient extensionAutomationClient,
        ActiveBrowserAutomationService activeBrowserAutomationService,
        LassoSelectionService lassoSelectionService,
        ScreenCaptureService screenCaptureService,
        VoiceCommandPromptService voiceCommandPromptService,
        WindowFocusTracker windowFocusTracker,
        IntentMemoryService intentMemoryService,
        InteractionMode initialMode,
        CorsiriFloatingPopup? floatingPopup = null,
        ChatbotWindow? chatbotWindow = null)
    {
        _cursorTracker = cursorTracker;
        _selectionDetector = selectionDetector;
        _orbOverlayWindow = orbOverlayWindow;
        _resultPanelWindow = resultPanelWindow;
        _clipboardService = clipboardService;
        _NovaClient = NovaClient;
        _browserAutomationClient = browserAutomationClient;
        _extensionAutomationClient = extensionAutomationClient;
        _activeBrowserAutomationService = activeBrowserAutomationService;
        _lassoSelectionService = lassoSelectionService;
        _screenCaptureService = screenCaptureService;
        _voiceCommandPromptService = voiceCommandPromptService;
        _windowFocusTracker = windowFocusTracker;
        _intentMemoryService = intentMemoryService;
        _interactionMode = initialMode;
        _floatingPopup = floatingPopup;
        _chatbotWindow = chatbotWindow;

        if (_floatingPopup is not null && _chatbotWindow is not null)
        {
            _floatingPopup.OpenChatbotRequested += (s, text) =>
            {
                Application.Current?.Dispatcher.Invoke(() =>
                {
                    _chatbotWindow.OpenWithContext(text);
                });
            };
        }

        _autoReplaceEnabled = ParseBoolEnv("CORSIRI_ENABLE_AUTO_REPLACE", defaultValue: true);
        _autoReplaceConfidenceThreshold = ParseDoubleEnv("CORSIRI_AUTO_REPLACE_CONFIDENCE", defaultValue: 0.9);
        _managedBrowserFallbackEnabled = ParseBoolEnv("CORSIRI_ENABLE_MANAGED_BROWSER_FALLBACK", defaultValue: false);
        _textVisualContextEnabled = ParseBoolEnv("CORSIRI_ENABLE_TEXT_SCREEN_CONTEXT", defaultValue: false);
        _textVisualContextWidth = ParseIntEnv("CORSIRI_TEXT_SCREEN_CONTEXT_WIDTH", defaultValue: 480);
        _textVisualContextHeight = ParseIntEnv("CORSIRI_TEXT_SCREEN_CONTEXT_HEIGHT", defaultValue: 320);
        _cursorTracker.PositionChanged += CursorTrackerOnPositionChanged;
        _resultPanelWindow.CopyRequested += ResultPanelWindowOnCopyRequested;
        _resultPanelWindow.InsertRequested += ResultPanelWindowOnInsertRequested;
        _resultPanelWindow.MoreOptionsRequested += ResultPanelWindowOnMoreOptionsRequested;
        _resultPanelWindow.TakeActionRequested += ResultPanelWindowOnTakeActionRequested;
        _resultPanelWindow.UndoRequested += ResultPanelWindowOnUndoRequested;
        _resultPanelWindow.SetUndoAvailable(false);
        _orbOverlayWindow.UpdateActionRing(_actions, _selectedActionIndex);
        _orbOverlayWindow.MoveToTopRight();
        _orbOverlayWindow.SetState(OrbState.Idle, $"Ready ({ModeToDisplay(_interactionMode)})");
    }

    public void OpenChatbot(string? contextText = null)
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            _chatbotWindow?.OpenWithContext(contextText ?? string.Empty);
        });
    }

    public event EventHandler<string>? OnActionChange;

    public event EventHandler<string>? OnActionExecute;

    public event EventHandler? OnProcessingStart;

    public event EventHandler? OnProcessingComplete;

    public event EventHandler<InteractionMode>? OnModeChanged;

    public string CurrentAction => _actions[_selectedActionIndex];

    public InteractionMode CurrentMode => _interactionMode;

    public void SetInteractionMode(InteractionMode mode)
    {
        if (_interactionMode == mode)
        {
            return;
        }

        _interactionMode = mode;
        _orbOverlayWindow.SetState(OrbState.Idle, $"Ready ({ModeToDisplay(_interactionMode)})");
        OnModeChanged?.Invoke(this, mode);
    }

    public async Task HandleLongPressAsync(CancellationToken cancellationToken)
    {
        _orbOverlayWindow.MoveToTopRight();
        _orbOverlayWindow.SetState(
            OrbState.Listening,
            cancellationToken.CanBeCanceled ? "Listening... release to send" : "Listening... speak your command");
        EnsureWindowVisible(_orbOverlayWindow);
        _lastExternalWindow = _windowFocusTracker.LastExternalWindowHandle;

        var voiceCommand = await _voiceCommandPromptService.PromptAsync(
            (state, message) => _orbOverlayWindow.SetState(state, message),
            level => _orbOverlayWindow.SetListeningLevel(level),
            cancellationToken);
        if (string.IsNullOrWhiteSpace(voiceCommand))
        {
            _orbOverlayWindow.SetState(OrbState.Idle, "Voice command canceled");
            return;
        }

        await HandleTapAsync(CancellationToken.None, voiceCommand, forceActionMenu: false);
    }

    public void HandleDialTick(int delta)
    {
        if (delta == 0)
        {
            return;
        }

        var step = Math.Sign(delta);
        _selectedActionIndex = (_selectedActionIndex + step + _actions.Length) % _actions.Length;
        _orbOverlayWindow.UpdateActionRing(_actions, _selectedActionIndex);
        _orbOverlayWindow.ShowActionRingTemporarily();
        OnActionChange?.Invoke(this, CurrentAction);
    }

    public Task HandleDialPressAsync(CancellationToken cancellationToken)
    {
        return HandleTapAsync(cancellationToken);
    }

    public async Task HandleTakeActionAsync(CancellationToken cancellationToken)
    {
        if (_lastSelectionContext is null || string.IsNullOrWhiteSpace(_lastResult))
        {
            _resultPanelWindow.ShowInfo(
                "No recent AI result is available for browser action execution yet.",
                _cursorTracker.CurrentPosition);
            return;
        }

        if (!await _runLock.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            OnProcessingStart?.Invoke(this, EventArgs.Empty);
            await ExecuteTakeActionFlowAsync(autoTriggered: false, cancellationToken);
        }
        finally
        {
            OnProcessingComplete?.Invoke(this, EventArgs.Empty);
            _runLock.Release();
        }
    }

    public async Task HandleImageSelectionAsync(CancellationToken cancellationToken)
    {
        if (!await _runLock.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            var cursor = _cursorTracker.CurrentPosition;
            _lastExternalWindow = _windowFocusTracker.LastExternalWindowHandle;
            _orbOverlayWindow.MoveToTopRight();
            _orbOverlayWindow.HideActionRing();
            EnsureWindowVisible(_orbOverlayWindow);
            _orbOverlayWindow.SetState(OrbState.Processing, "Select an image region...");
            OnProcessingStart?.Invoke(this, EventArgs.Empty);

            await ExecuteDirectImageSelectionFlowAsync(
                voiceCommand: null,
                forceActionMenu: false,
                showHexFallbackOnCancel: false,
                cursor,
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            _orbOverlayWindow.SetState(OrbState.Idle, "Image selection canceled");
            OnProcessingComplete?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception ex)
        {
            _orbOverlayWindow.SetState(OrbState.Completed, "Image selection failed");
            _resultPanelWindow.ShowInfo($"Error: {ex.Message}", _cursorTracker.CurrentPosition);
            OnProcessingComplete?.Invoke(this, EventArgs.Empty);
        }
        finally
        {
            _runLock.Release();
        }
    }

    public async Task HandleTapAsync(CancellationToken cancellationToken)
    {
        await HandleTapAsync(cancellationToken, voiceCommand: null, forceActionMenu: false);
    }

    private async Task HandleTapAsync(CancellationToken cancellationToken, string? voiceCommand, bool forceActionMenu)
    {
        if (!await _runLock.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            var cursor = _cursorTracker.CurrentPosition;
            _lastExternalWindow = _windowFocusTracker.LastExternalWindowHandle;

            _orbOverlayWindow.MoveToTopRight();
            _orbOverlayWindow.HideActionRing();
            EnsureWindowVisible(_orbOverlayWindow);
            _orbOverlayWindow.SetState(OrbState.Processing, "Analyzing selection...");
            OnProcessingStart?.Invoke(this, EventArgs.Empty);

            var selection = await _selectionDetector.CaptureSelectionAsync(_lastExternalWindow, cancellationToken);
            if (!selection.HasText && !selection.HasImage)
            {
                await HandleImageFallbackAsync(voiceCommand, forceActionMenu, cancellationToken);
                return;
            }

            if (selection.HasText)
            {
                if (_floatingPopup is not null && string.IsNullOrWhiteSpace(voiceCommand))
                {
                    _orbOverlayWindow.SetState(OrbState.Idle, "Ready");
                    Application.Current?.Dispatcher.Invoke(() =>
                    {
                        _floatingPopup.ShowForSelection(selection.Text!, cursor);
                    });
                    return;
                }

                await ExecuteTextFlowAsync(
                    selection.Text!,
                    selection.ImageBase64,
                    selection.ImageMimeType,
                    voiceCommand,
                    cursor,
                    forceActionMenu,
                    cancellationToken);
                return;
            }

            await ExecuteImageFlowAsync(
                selection.ImageBase64!,
                selection.ImageMimeType ?? "image/png",
                voiceCommand,
                cursor,
                forceActionMenu,
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            _orbOverlayWindow.SetState(OrbState.Completed, "Request timed out");
            _resultPanelWindow.ShowInfo(
                "Request timed out. Try a shorter selection or retry.",
                _cursorTracker.CurrentPosition);
        }
        catch (Exception ex)
        {
            _orbOverlayWindow.SetState(OrbState.Completed, "Failed to process request");
            _resultPanelWindow.ShowInfo($"Error: {ex.Message}", _cursorTracker.CurrentPosition);
        }
        finally
        {
            _runLock.Release();
        }
    }

    public void CancelLassoPlaceholder()
    {
        _orbOverlayWindow.SetState(OrbState.Idle, $"Lasso mode canceled ({ModeToDisplay(_interactionMode)})");
    }

    public void Dispose()
    {
        _cursorTracker.PositionChanged -= CursorTrackerOnPositionChanged;
        _resultPanelWindow.CopyRequested -= ResultPanelWindowOnCopyRequested;
        _resultPanelWindow.InsertRequested -= ResultPanelWindowOnInsertRequested;
        _resultPanelWindow.MoreOptionsRequested -= ResultPanelWindowOnMoreOptionsRequested;
        _resultPanelWindow.TakeActionRequested -= ResultPanelWindowOnTakeActionRequested;
        _resultPanelWindow.UndoRequested -= ResultPanelWindowOnUndoRequested;
        _runLock.Dispose();
    }

    private async Task ExecuteTextFlowAsync(
        string selectedText,
        string? selectedImageBase64,
        string? selectedImageMimeType,
        string? voiceCommand,
        Point cursor,
        bool forceActionMenu,
        CancellationToken cancellationToken)
    {
        var mode = ModeToProtocol(_interactionMode);
        var textVisualContext = !string.IsNullOrWhiteSpace(selectedImageBase64) && !string.IsNullOrWhiteSpace(selectedImageMimeType)
            ? (ImageBase64: selectedImageBase64, ImageMimeType: selectedImageMimeType)
            : TryCaptureTextVisualContext(cursor);
        var suggestion = await _NovaClient.SuggestTextActionsAsync(
            selectedText,
            mode,
            _windowFocusTracker.LastExternalProcessName,
            cursor,
            textVisualContext.ImageBase64,
            textVisualContext.ImageMimeType,
            cancellationToken);

        var decision = await ResolveActionDecisionAsync(suggestion, voiceCommand, forceActionMenu, cancellationToken);
        if (decision is null)
        {
            _orbOverlayWindow.SetState(OrbState.Idle, "Action canceled");
            return;
        }

        var actionHint = decision.Value.ActionHint;
        if (!string.IsNullOrWhiteSpace(actionHint))
        {
            TrySyncActionRing(actionHint);
            OnActionExecute?.Invoke(this, ToDisplayAction(actionHint));
            _orbOverlayWindow.SetState(OrbState.Processing, $"Running {ToDisplayAction(actionHint).ToLowerInvariant()}...");
        }
        else
        {
            _orbOverlayWindow.SetState(OrbState.Processing, "Analyzing selection...");
        }

        var response = await _NovaClient.AnalyzeTextAsync(
            selectedText,
            actionHint,
            mode,
            _windowFocusTracker.LastExternalProcessName,
            decision.Value.VoiceCommand,
            cursor,
            textVisualContext.ImageBase64,
            textVisualContext.ImageMimeType,
            cancellationToken);

        await CompleteSuccessfulRunAsync(
            response,
            cursor,
            new CapturedSelectionContext
            {
                Kind = string.IsNullOrWhiteSpace(textVisualContext.ImageBase64) ? "text" : "text_image",
                Text = selectedText,
                ImageBase64 = textVisualContext.ImageBase64,
                ImageMimeType = textVisualContext.ImageMimeType,
                ContentType = suggestion.ContentType,
                VoiceCommand = decision.Value.VoiceCommand,
                SourceWindowHandle = _lastExternalWindow,
                SourceProcessName = _windowFocusTracker.LastExternalProcessName,
                Suggestion = suggestion
            });
    }

    private async Task HandleImageFallbackAsync(string? voiceCommand, bool forceActionMenu, CancellationToken cancellationToken)
    {
        await ExecuteDirectImageSelectionFlowAsync(
            voiceCommand,
            forceActionMenu,
            showHexFallbackOnCancel: true,
            _cursorTracker.CurrentPosition,
            cancellationToken);
    }

    private async Task ExecuteDirectImageSelectionFlowAsync(
        string? voiceCommand,
        bool forceActionMenu,
        bool showHexFallbackOnCancel,
        Point cursor,
        CancellationToken cancellationToken)
    {
        _orbOverlayWindow.SetState(OrbState.Processing, "Drag to select an image region...");
        var selectionResult = await _lassoSelectionService.CaptureSelectionAsync(cancellationToken);
        if (selectionResult.IsCanceled)
        {
            if (!showHexFallbackOnCancel)
            {
                _orbOverlayWindow.SetState(OrbState.Idle, "Image selection canceled");
                _resultPanelWindow.ShowInfo("Image selection canceled.", cursor);
                OnProcessingComplete?.Invoke(this, EventArgs.Empty);
                return;
            }

            var hexColor = _screenCaptureService.SamplePixelHex(cursor);
            _lastResult = hexColor;
            _lastSelectionContext = null;
            await _clipboardService.SetTextAsync(hexColor);
            _orbOverlayWindow.SetState(OrbState.Completed, $"{hexColor} copied");
            _resultPanelWindow.ShowInfo($"{hexColor} copied to clipboard.", cursor);
            OnProcessingComplete?.Invoke(this, EventArgs.Empty);
            return;
        }

        await Task.Delay(80, cancellationToken);
        var imageBase64 = _screenCaptureService.CaptureRegionAsBase64Png(selectionResult.Region);
        await ExecuteImageFlowAsync(
            imageBase64,
            "image/png",
            voiceCommand,
            _cursorTracker.CurrentPosition,
            forceActionMenu,
            cancellationToken);
    }

    private async Task CompleteSuccessfulRunAsync(AgentResponse response, Point cursor, CapturedSelectionContext context)
    {
        var normalizedAction = NormalizeActionHint(response.Action);
        _lastResult = response.Result;
        _lastSelectionContext = context with
        {
            Suggestion = new SuggestionResponse
            {
                ContentType = context.ContentType,
                BestAction = normalizedAction,
                RecommendedAction = normalizedAction,
                Confidence = response.Confidence,
                Alternatives = response.Alternatives
                    .Select(NormalizeActionHint)
                    .Where(a => !string.IsNullOrWhiteSpace(a))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList(),
                ExtendedAlternatives = context.Suggestion.ExtendedAlternatives
                    .Select(NormalizeActionHint)
                    .Where(a => !string.IsNullOrWhiteSpace(a))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList()
            },
            ExecutedAction = normalizedAction
        };

        await _clipboardService.SetTextAsync(response.Result);
        await _intentMemoryService.RecordAsync(context.ContentType, normalizedAction);

        var didAutoReplace = await TryAutoReplaceAsync(normalizedAction, response.Confidence, context);
        if (didAutoReplace && _lastExternalWindow != IntPtr.Zero)
        {
            PushUndoHistory(new UndoHistoryEntry(UndoTarget.ExternalWindow, _lastExternalWindow, $"Undo {ToDisplayAction(normalizedAction)} replace"));
        }

        _orbOverlayWindow.SetState(
            OrbState.Completed,
            didAutoReplace
                ? "Replaced in app + copied (Ctrl+Z to undo)"
                : "Result copied to clipboard");

        _resultPanelWindow.ShowResult(
            ToDisplayAction(response.Action),
            didAutoReplace
                ? $"{response.Result}\n\n[Auto-replaced in app. Press Ctrl+Z in target app to undo.]"
                : response.Result,
            cursor);

        OnProcessingComplete?.Invoke(this, EventArgs.Empty);
    }

    private async Task ExecuteImageFlowAsync(
        string imageBase64,
        string imageMimeType,
        string? voiceCommand,
        Point cursorPosition,
        bool forceActionMenu,
        CancellationToken cancellationToken)
    {
        var mode = ModeToProtocol(_interactionMode);
        var suggestion = await _NovaClient.SuggestImageActionsAsync(
            imageBase64,
            imageMimeType,
            mode,
            _windowFocusTracker.LastExternalProcessName,
            cursorPosition,
            cancellationToken);

        var decision = await ResolveActionDecisionAsync(suggestion, voiceCommand, forceActionMenu, cancellationToken);
        if (decision is null)
        {
            _orbOverlayWindow.SetState(OrbState.Idle, "Action canceled");
            return;
        }

        var actionHint = decision.Value.ActionHint;
        if (!string.IsNullOrWhiteSpace(actionHint))
        {
            TrySyncActionRing(actionHint);
            OnActionExecute?.Invoke(this, ToDisplayAction(actionHint));
            _orbOverlayWindow.SetState(OrbState.Processing, $"Analyzing image ({ToDisplayAction(actionHint)})...");
        }
        else
        {
            _orbOverlayWindow.SetState(OrbState.Processing, "Analyzing image...");
        }

        var response = await _NovaClient.AnalyzeImageAsync(
            imageBase64,
            imageMimeType,
            actionHint,
            mode,
            _windowFocusTracker.LastExternalProcessName,
            decision.Value.VoiceCommand,
            cursorPosition,
            cancellationToken);

        await CompleteSuccessfulRunAsync(
            response,
            cursorPosition,
            new CapturedSelectionContext
            {
                Kind = "image",
                ImageBase64 = imageBase64,
                ImageMimeType = imageMimeType,
                ContentType = suggestion.ContentType,
                VoiceCommand = decision.Value.VoiceCommand,
                SourceWindowHandle = _lastExternalWindow,
                SourceProcessName = _windowFocusTracker.LastExternalProcessName,
                Suggestion = suggestion
            });
    }

    private async Task<ActionDecision?> ResolveActionDecisionAsync(
        SuggestionResponse suggestion,
        string? voiceCommand,
        bool forceActionMenu,
        CancellationToken cancellationToken)
    {
        var normalizedSuggestion = NormalizeSuggestion(suggestion);
        var bestAction = !string.IsNullOrWhiteSpace(normalizedSuggestion.BestAction)
            ? normalizedSuggestion.BestAction
            : normalizedSuggestion.RecommendedAction;

        if (forceActionMenu || (_interactionMode == InteractionMode.Guided && string.IsNullOrWhiteSpace(voiceCommand)))
        {
            var menuOptions = await BuildActionMenuOptionsAsync(normalizedSuggestion, cancellationToken);
            var selectedOption = await ShowActionMenuAsync(menuOptions, normalizedSuggestion.ContentType);
            if (string.IsNullOrWhiteSpace(selectedOption))
            {
                return null;
            }

            if (string.Equals(selectedOption, CustomVoiceCommandOption, StringComparison.OrdinalIgnoreCase))
            {
                var customVoice = await _voiceCommandPromptService.PromptAsync(
                    (state, message) => _orbOverlayWindow.SetState(state, message),
                    level => _orbOverlayWindow.SetListeningLevel(level),
                    cancellationToken);
                if (string.IsNullOrWhiteSpace(customVoice))
                {
                    return null;
                }

                return new ActionDecision(null, customVoice, bestAction);
            }

            if (selectedOption.StartsWith(AiSuggestPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return new ActionDecision(bestAction, voiceCommand, bestAction);
            }

            var selectedAction = NormalizeActionHint(selectedOption);
            return new ActionDecision(selectedAction, voiceCommand, selectedAction);
        }

        // Smart mode: Nova decides from the selection context. Do not force the suggested action.
        return new ActionDecision(null, voiceCommand, bestAction);
    }

    private Task<GuidedMenuOptions> BuildActionMenuOptionsAsync(SuggestionResponse suggestion, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var initial = new List<string>();
        AddUniqueOption(initial, $"{AiSuggestPrefix}{ToDisplayAction(suggestion.BestAction ?? suggestion.RecommendedAction)})");

        foreach (var prewritten in GetBasicStageOneDefaults(suggestion.ContentType))
        {
            AddUniqueOption(initial, prewritten);
        }

        AddUniqueOption(initial, CustomVoiceCommandOption);

        var deferred = new List<string>();
        foreach (var action in suggestion.Alternatives)
        {
            AddUniqueOption(deferred, ToDisplayAction(action));
        }

        foreach (var action in GetPrimaryDefaultsForContentType(suggestion.ContentType))
        {
            AddUniqueOption(deferred, action);
        }

        foreach (var action in suggestion.ExtendedAlternatives)
        {
            AddUniqueOption(deferred, ToDisplayAction(action));
        }

        foreach (var action in GetContextualExpandedDefaults(suggestion.ContentType))
        {
            AddUniqueOption(deferred, action);
        }

        deferred = deferred
            .Where(option =>
                !initial.Contains(option, StringComparer.OrdinalIgnoreCase) &&
                !option.StartsWith(AiSuggestPrefix, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(option, CustomVoiceCommandOption, StringComparison.OrdinalIgnoreCase))
            .Take(4)
            .ToList();

        return Task.FromResult(new GuidedMenuOptions(initial, deferred));
    }

    private static Task<string?> ShowActionMenuAsync(GuidedMenuOptions options, string contentType)
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            var menu = new ActionMenuWindow(options.InitialOptions, options.DeferredOptions, contentType);
            var accepted = menu.ShowDialog();
            return accepted == true ? menu.SelectedAction : null;
        }).Task;
    }

    private static SuggestionResponse NormalizeSuggestion(SuggestionResponse suggestion)
    {
        var bestAction = NormalizeActionHint(
            string.IsNullOrWhiteSpace(suggestion.BestAction)
                ? suggestion.RecommendedAction
                : suggestion.BestAction);

        var alternatives = suggestion.Alternatives
            .Select(NormalizeActionHint)
            .Where(a => !string.IsNullOrWhiteSpace(a))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (!alternatives.Contains(bestAction, StringComparer.OrdinalIgnoreCase))
        {
            alternatives.Insert(0, bestAction);
        }

        var extended = suggestion.ExtendedAlternatives
            .Select(NormalizeActionHint)
            .Where(a => !string.IsNullOrWhiteSpace(a))
            .Where(a => !alternatives.Contains(a, StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new SuggestionResponse
        {
            ContentType = string.IsNullOrWhiteSpace(suggestion.ContentType) ? "general_text" : suggestion.ContentType,
            BestAction = bestAction,
            RecommendedAction = bestAction,
            Confidence = suggestion.Confidence,
            Alternatives = alternatives,
            ExtendedAlternatives = extended
        };
    }

    private static IReadOnlyList<string> GetContextualExpandedDefaults(string contentType)
    {
        return contentType.ToLowerInvariant() switch
        {
            "mcq" => ["Explain Step By Step", "Eliminate Wrong Options", "Create Answer Key", "Convert To Flashcards"],
            "report" => ["Extract Insights", "Executive Summary", "Extract Action Items", "Extract Metrics", "Create Slide Outline"],
            "code" => ["Write Tests", "Refactor Code", "Find Edge Cases", "Add Code Comments"],
            "email" => ["Draft Reply", "Change Tone", "Shorten Email", "Formal Version", "Friendly Version"],
            "product" => ["Pros and Cons", "Buyer Checklist", "Red Flags", "Best Use Cases"],
            "social_caption" => ["Generate Hashtags", "Hook Variants", "Short Caption", "Long Caption"],
            "question" => ["Fact Check", "Compare Answers", "Convert To Flashcards", "Explain Step By Step", "Extract Insights"],
            "image" => ["Generate Captions", "Create Alt Text", "Describe Scene", "Compare Visual Details"],
            _ => ["Extract Insights", "Grammar Fix", "Expand Text", "Simplify Language", "Convert To Table"]
        };
    }

    private static IReadOnlyList<string> GetBasicStageOneDefaults(string contentType)
    {
        return contentType.ToLowerInvariant() switch
        {
            "image" => ["Describe Image", "Extract Key Details", "Identify Objects", "Extract Dominant Colors", "Generate Captions", "Create Alt Text"],
            "code" => ["Explain Code", "Debug Code", "Improve Code", "Optimize Code", "Write Tests", "Translate"],
            "email" => ["Polish Email", "Draft Reply", "Rewrite", "Translate", "Bullet Points", "Extract Insights"],
            "question" => ["Answer Question", "Explain", "Extract Insights", "Bullet Points", "Translate", "Rewrite"],
            "mcq" => ["Answer Question", "Explain", "Create Answer Key", "Eliminate Wrong Options", "Bullet Points", "Translate"],
            "report" => ["Extract Insights", "Summarize", "Bullet Points", "Rewrite Structured", "Translate", "Expand"],
            "product" => ["Extract Product Info", "Compare Prices", "Find Reviews", "Show Product Details", "Bullet Points", "Translate"],
            _ => ["Summarize", "Rewrite", "Explain", "Translate", "Extract Insights", "Bullet Points", "Expand"]
        };
    }

    private static IReadOnlyList<string> GetPrimaryDefaultsForContentType(string contentType)
    {
        return contentType.ToLowerInvariant() switch
        {
            "mcq" => ["Answer Question", "Explain", "Extract Insights", "Bullet Points", "Compare Answers", "Eliminate Wrong Options"],
            "question" => ["Answer Question", "Explain", "Extract Insights", "Fact Check", "Compare Answers", "Bullet Points"],
            "email" => ["Polish Email", "Draft Reply", "Rewrite", "Change Tone", "Shorten Email", "Translate"],
            "code" => ["Improve Code", "Debug Code", "Explain Code", "Optimize Code", "Write Tests"],
            "report" => ["Extract Insights", "Bullet Points", "Summarize", "Executive Summary", "Extract Action Items", "Extract Metrics"],
            "product" => ["Extract Product Info", "Compare Prices", "Find Reviews", "Extract Insights", "Pros and Cons", "Buyer Checklist"],
            "social_caption" => ["Suggest Captions", "Generate Captions", "Generate Hashtags", "Hook Variants", "Rewrite"],
            "image" => ["Describe Image", "Find Key Details", "Identify Objects", "Extract Dominant Colors", "Generate Captions"],
            _ => ["Extract Insights", "Summarize", "Expand", "Rewrite", "Translate", "Explain", "Bullet Points"]
        };
    }

    private static void AddUniqueOption(ICollection<string> options, string option)
    {
        if (string.IsNullOrWhiteSpace(option))
        {
            return;
        }

        if (!options.Contains(option, StringComparer.OrdinalIgnoreCase))
        {
            options.Add(option);
        }
    }

    private async Task<bool> TryAutoReplaceAsync(string normalizedAction, double confidence, CapturedSelectionContext context)
    {
        if (!_autoReplaceEnabled)
        {
            return false;
        }

        if (_interactionMode != InteractionMode.Smart)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(context.Text))
        {
            return false;
        }

        if (!AutoReplaceActions.Contains(normalizedAction))
        {
            return false;
        }

        if (confidence < _autoReplaceConfidenceThreshold)
        {
            return false;
        }

        if (_lastExternalWindow == IntPtr.Zero)
        {
            return false;
        }

        NativeMethods.BringToFront(_lastExternalWindow);
        await Task.Delay(60);
        NativeMethods.SendCtrlV();
        return true;
    }

    private void TrySyncActionRing(string actionHint)
    {
        var normalized = NormalizeActionHint(actionHint);
        var newIndex = Array.FindIndex(_actions, a =>
            string.Equals(NormalizeActionHint(a), normalized, StringComparison.OrdinalIgnoreCase));

        if (newIndex < 0)
        {
            return;
        }

        _selectedActionIndex = newIndex;
        _orbOverlayWindow.UpdateActionRing(_actions, _selectedActionIndex);
        OnActionChange?.Invoke(this, CurrentAction);
    }

    private void CursorTrackerOnPositionChanged(object? sender, System.Windows.Point e)
    {
        // Keep the orb anchored unless the user drags it manually.
    }

    private async void ResultPanelWindowOnCopyRequested(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_lastResult))
        {
            return;
        }

        await _clipboardService.SetTextAsync(_lastResult);
        _orbOverlayWindow.SetState(OrbState.Completed, "Copied");
    }

    private async void ResultPanelWindowOnInsertRequested(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_lastResult))
        {
            return;
        }

        await _clipboardService.SetTextAsync(_lastResult);
        if (_lastExternalWindow != IntPtr.Zero)
        {
            NativeMethods.BringToFront(_lastExternalWindow);
            await Task.Delay(40);
        }

        NativeMethods.SendCtrlV();
        _orbOverlayWindow.SetState(OrbState.Completed, "Inserted");
    }

    private async void ResultPanelWindowOnTakeActionRequested(object? sender, EventArgs e)
    {
        await HandleTakeActionAsync(CancellationToken.None);
    }

    private async Task ExecuteTakeActionFlowAsync(bool autoTriggered, CancellationToken cancellationToken)
    {
        if (_lastSelectionContext is null || string.IsNullOrWhiteSpace(_lastResult))
        {
            _resultPanelWindow.ShowInfo(
                "No recent AI result is available for browser action execution yet.",
                _cursorTracker.CurrentPosition);
            return;
        }

        ExtensionBridgeHealthResponse? extensionHealth = null;
        try
        {
            var cursor = _cursorTracker.CurrentPosition;
            EnsureWindowVisible(_orbOverlayWindow);
            _orbOverlayWindow.SetState(
                OrbState.Processing,
                autoTriggered ? "Preparing action..." : "Preparing Take Action...");

            var sourceIsBrowser =
                IsBrowserProcess(_lastSelectionContext.SourceProcessName) &&
                _lastSelectionContext.SourceWindowHandle != IntPtr.Zero;
            extensionHealth = sourceIsBrowser && IsChromiumBrowserProcess(_lastSelectionContext.SourceProcessName)
                ? await _extensionAutomationClient.TryGetHealthAsync(cancellationToken)
                : null;

            var extensionBrowserContext = sourceIsBrowser && IsChromiumBrowserProcess(_lastSelectionContext.SourceProcessName)
                ? await _extensionAutomationClient.TryGetActiveTabContextAsync(cancellationToken)
                : null;
            var extensionPageContext = extensionBrowserContext?.PageContext;
            var shouldUseExtensionBrowserSession = extensionBrowserContext?.Ok == true &&
                                                  extensionPageContext is not null &&
                                                  !string.IsNullOrWhiteSpace(extensionPageContext.Url);
            var activeBrowserContext = sourceIsBrowser
                ? _activeBrowserAutomationService.TryBuildPageContext(_lastSelectionContext.SourceWindowHandle)
                : null;
            var currentBrowserUrl = shouldUseExtensionBrowserSession
                ? extensionPageContext!.Url
                : string.IsNullOrWhiteSpace(activeBrowserContext?.Url)
                    ? null
                    : activeBrowserContext.Url;
            var targetUrl = ResolveTakeActionTargetUrl(_lastSelectionContext, currentBrowserUrl);
            var preferredBrowserChannel = ResolvePreferredBrowserChannel(_lastSelectionContext.SourceProcessName);

            BrowserPageContext planContext;
            BrowserPageContextResponse? managedBrowserReady = null;
            var canUseActiveBrowserSession = activeBrowserContext is not null && sourceIsBrowser;
            var shouldUseActiveBrowserSession = !shouldUseExtensionBrowserSession && canUseActiveBrowserSession;
            if (shouldUseExtensionBrowserSession)
            {
                planContext = extensionPageContext!;
                _orbOverlayWindow.SetState(OrbState.Processing, "Planning actions for current browser tab...");
            }
            else if (shouldUseActiveBrowserSession)
            {
                planContext = activeBrowserContext!;
                _orbOverlayWindow.SetState(OrbState.Processing, "Planning actions for current browser...");
            }
            else if (_managedBrowserFallbackEnabled)
            {
                _orbOverlayWindow.SetState(OrbState.Processing, "Opening managed action browser...");
                managedBrowserReady = await _browserAutomationClient.EnsureBrowserAsync(
                    preferredBrowserChannel,
                    targetUrl,
                    cancellationToken);
                planContext = managedBrowserReady.PageContext;
            }
            else
            {
                _orbOverlayWindow.SetState(OrbState.Completed, "Current browser required");
                _resultPanelWindow.ShowInfo(
                    BuildTakeActionRetryHint(
                        targetUrl,
                        currentBrowserUrl,
                        usingExtensionBrowserSession: false,
                        usingActiveBrowserSession: false,
                        extensionUnavailableForCurrentTab: IsExtensionUnavailable(extensionHealth),
                        managedBrowserFallbackEnabled: _managedBrowserFallbackEnabled),
                    cursor,
                    allowTakeAction: true);
                return;
            }

            _orbOverlayWindow.SetState(
                OrbState.Processing,
                autoTriggered ? "Planning auto action..." : "Planning Take Action...");

            var selectedAction = string.IsNullOrWhiteSpace(_lastSelectionContext.ExecutedAction)
                ? _lastSelectionContext.Suggestion.BestAction ?? _lastSelectionContext.Suggestion.RecommendedAction
                : _lastSelectionContext.ExecutedAction;
            var executionInstruction = _lastSelectionContext.VoiceCommand;

            var plan = await BuildBrowserActionPlanAsync(
                planContext,
                selectedAction,
                executionInstruction,
                cancellationToken);

            if (plan.Steps.Count == 0)
            {
                _orbOverlayWindow.SetState(OrbState.Completed, "Take Action ready");
                _resultPanelWindow.ShowInfo(
                    $"Take Action paused.{Environment.NewLine}{Environment.NewLine}{plan.Summary}{Environment.NewLine}{Environment.NewLine}{BuildTakeActionRetryHint(targetUrl, currentBrowserUrl, shouldUseExtensionBrowserSession, shouldUseActiveBrowserSession, IsExtensionUnavailable(extensionHealth), _managedBrowserFallbackEnabled)}",
                    cursor,
                    allowTakeAction: true);
                return;
            }

            if (!autoTriggered)
            {
                var previewDecision = await ShowActionPlanPreviewAsync(plan, ToDisplayAction(selectedAction), executionInstruction);
                if (previewDecision.ChangeResultRequested)
                {
                    var decision = await ResolveActionDecisionAsync(
                        _lastSelectionContext.Suggestion,
                        _lastSelectionContext.VoiceCommand,
                        forceActionMenu: true,
                        cancellationToken);

                    if (decision is null)
                    {
                        _orbOverlayWindow.SetState(OrbState.Idle, "Take Action change canceled");
                        return;
                    }

                    await ReRunLastSelectionAsync(decision.Value, cancellationToken);
                    return;
                }

                if (!previewDecision.Approved)
                {
                    _orbOverlayWindow.SetState(OrbState.Idle, "Take Action canceled");
                    return;
                }

                executionInstruction = CombineExecutionInstruction(_lastSelectionContext.VoiceCommand, previewDecision.AdditionalInstruction);
                if (!string.Equals(executionInstruction, _lastSelectionContext.VoiceCommand, StringComparison.Ordinal))
                {
                    _orbOverlayWindow.SetState(OrbState.Processing, "Refining Take Action plan...");
                    plan = await BuildBrowserActionPlanAsync(
                        planContext,
                        selectedAction,
                        executionInstruction,
                        cancellationToken);
                    if (plan.Steps.Count == 0)
                    {
                        _orbOverlayWindow.SetState(OrbState.Completed, "Take Action ready");
                        _resultPanelWindow.ShowInfo(
                            $"Take Action paused.{Environment.NewLine}{Environment.NewLine}{plan.Summary}{Environment.NewLine}{Environment.NewLine}{BuildTakeActionRetryHint(targetUrl, currentBrowserUrl, shouldUseExtensionBrowserSession, shouldUseActiveBrowserSession, IsExtensionUnavailable(extensionHealth), _managedBrowserFallbackEnabled)}",
                            cursor,
                            allowTakeAction: true);
                        return;
                    }
                }
            }

            if (plan.RequiresConfirmation)
            {
                var confirmed = await Application.Current.Dispatcher.InvokeAsync(() =>
                    MessageBox.Show(
                        $"{plan.Summary}{Environment.NewLine}{Environment.NewLine}This browser action needs confirmation before it continues.",
                        autoTriggered ? "Corsiri Auto Take Action" : "Corsiri Take Action",
                        MessageBoxButton.OKCancel,
                        MessageBoxImage.Question) == MessageBoxResult.OK);

                if (!confirmed)
                {
                    _orbOverlayWindow.SetState(
                        OrbState.Idle,
                        autoTriggered ? "Auto handoff canceled" : "Take Action canceled");
                    return;
                }
            }

            OnActionExecute?.Invoke(this, autoTriggered ? "Auto Take Action" : "Take Action");
            _orbOverlayWindow.SetState(
                OrbState.Processing,
                autoTriggered
                    ? $"Auto-applying {plan.Steps.Count} step(s)..."
                    : $"Executing {plan.Steps.Count} step(s)...");

            BrowserExecutionResponse execution;
            var executedInExtensionBrowser = false;
            var executedInActiveBrowser = false;
            if (shouldUseExtensionBrowserSession)
            {
                execution = await _extensionAutomationClient.ExecutePlanAsync(plan, cancellationToken);
                if (execution.Success)
                {
                    executedInExtensionBrowser = true;
                }
                else if (canUseActiveBrowserSession)
                {
                    _orbOverlayWindow.SetState(OrbState.Processing, "Retrying in current browser window...");
                    execution = await _activeBrowserAutomationService.ExecutePlanAsync(
                        _lastSelectionContext.SourceWindowHandle,
                        plan,
                        cancellationToken);

                    if (execution.Success)
                    {
                        executedInActiveBrowser = true;
                    }
                    else if (_managedBrowserFallbackEnabled)
                    {
                        _orbOverlayWindow.SetState(OrbState.Processing, "Retrying in managed browser...");
                        managedBrowserReady ??= await _browserAutomationClient.EnsureBrowserAsync(
                            preferredBrowserChannel,
                            targetUrl,
                            cancellationToken);
                        execution = await _browserAutomationClient.ExecutePlanAsync(plan, cancellationToken);
                    }
                }
                else if (_managedBrowserFallbackEnabled)
                {
                    _orbOverlayWindow.SetState(OrbState.Processing, "Retrying in managed browser...");
                    managedBrowserReady ??= await _browserAutomationClient.EnsureBrowserAsync(
                        preferredBrowserChannel,
                        targetUrl,
                        cancellationToken);
                    execution = await _browserAutomationClient.ExecutePlanAsync(plan, cancellationToken);
                }
            }
            else if (shouldUseActiveBrowserSession)
            {
                execution = await _activeBrowserAutomationService.ExecutePlanAsync(
                    _lastSelectionContext.SourceWindowHandle,
                    plan,
                    cancellationToken);

                if (execution.Success)
                {
                    executedInActiveBrowser = true;
                }
                else if (_managedBrowserFallbackEnabled)
                {
                    _orbOverlayWindow.SetState(OrbState.Processing, "Retrying in managed browser...");
                    managedBrowserReady ??= await _browserAutomationClient.EnsureBrowserAsync(
                        preferredBrowserChannel,
                        targetUrl,
                        cancellationToken);
                    execution = await _browserAutomationClient.ExecutePlanAsync(plan, cancellationToken);
                }
            }
            else
            {
                execution = await _browserAutomationClient.ExecutePlanAsync(plan, cancellationToken);
            }

            _orbOverlayWindow.SetState(
                OrbState.Completed,
                execution.Success
                    ? (executedInExtensionBrowser
                        ? "Applied in current tab"
                        : executedInActiveBrowser
                            ? "Applied in current browser"
                            : (autoTriggered ? "Browser action applied" : "Browser action complete"))
                    : "Browser action failed");
            if (execution.Success && execution.ExecutedSteps > 0)
            {
                PushUndoHistory(new UndoHistoryEntry(UndoTarget.Browser, IntPtr.Zero, $"Undo browser action: {plan.Summary}"));
            }

                _resultPanelWindow.ShowInfo(
                    BuildTakeActionSummary(plan, execution, extensionHealth),
                    cursor,
                    allowTakeAction: true);
        }
        catch (Exception ex)
        {
            _orbOverlayWindow.SetState(OrbState.Completed, autoTriggered ? "Auto handoff failed" : "Browser action failed");
            _resultPanelWindow.ShowInfo(
                $"{(autoTriggered ? "Auto Take Action" : "Take Action")} failed.{Environment.NewLine}{Environment.NewLine}{ex.Message}{Environment.NewLine}{Environment.NewLine}{BuildTakeActionRetryHint(null, null, false, false, IsExtensionUnavailable(extensionHealth), _managedBrowserFallbackEnabled)}",
                _cursorTracker.CurrentPosition,
                allowTakeAction: true);
        }
    }

    private static bool ContainsBrowserExecutionIntent(string? voiceCommand)
    {
        if (string.IsNullOrWhiteSpace(voiceCommand))
        {
            return false;
        }

        var normalized = voiceCommand.Trim().ToLowerInvariant();
        string[] executionKeywords =
        [
            "send",
            "schedule",
            "submit",
            "fill",
            "autofill",
            "apply",
            "check",
            "tick",
            "mark",
            "select",
            "book",
            "complete",
            "post",
            "click",
            "open",
            "paste into",
            "enter into"
        ];

        return executionKeywords.Any(keyword => normalized.Contains(keyword, StringComparison.Ordinal));
    }

    private static string? ResolvePreferredBrowserChannel(string? processName)
    {
        if (string.IsNullOrWhiteSpace(processName))
        {
            return "chrome";
        }

        return processName.Trim().ToLowerInvariant() switch
        {
            "chrome" => "chrome",
            "brave" => "chrome",
            "opera" => "chrome",
            "opera_gx" => "chrome",
            "vivaldi" => "chrome",
            "arc" => "chrome",
            "msedge" => "msedge",
            "microsoftedge" => "msedge",
            _ => "chrome"
        };
    }

    private static string? ResolveTakeActionTargetUrl(CapturedSelectionContext context, string? currentBrowserUrl)
    {
        if (LooksLikeGoogleFormsUrl(currentBrowserUrl) || LooksLikeMailUrl(currentBrowserUrl))
        {
            return currentBrowserUrl;
        }

        if (IsBrowserExecutionFormContext(context))
        {
            return currentBrowserUrl;
        }

        if (string.Equals(context.ContentType, "email", StringComparison.OrdinalIgnoreCase))
        {
            return LooksLikeMailUrl(currentBrowserUrl)
                ? currentBrowserUrl
                : "https://mail.google.com/mail/u/0/#inbox?compose=new";
        }

        return currentBrowserUrl;
    }

    private static bool IsBrowserExecutionFormContext(CapturedSelectionContext context)
    {
        return string.Equals(context.ContentType, "mcq", StringComparison.OrdinalIgnoreCase) ||
               (string.Equals(context.ContentType, "question", StringComparison.OrdinalIgnoreCase) &&
                ContainsBrowserExecutionIntent(context.VoiceCommand));
    }

    private static bool IsBrowserProcess(string? processName)
    {
        if (string.IsNullOrWhiteSpace(processName))
        {
            return false;
        }

        return processName.Trim().ToLowerInvariant() switch
        {
            "chrome" => true,
            "chromium" => true,
            "msedge" => true,
            "microsoftedge" => true,
            "brave" => true,
            "firefox" => true,
            "opera" => true,
            "opera_gx" => true,
            "vivaldi" => true,
            "arc" => true,
            _ => false
        };
    }

    private static bool IsChromiumBrowserProcess(string? processName)
    {
        if (string.IsNullOrWhiteSpace(processName))
        {
            return false;
        }

        return processName.Trim().ToLowerInvariant() switch
        {
            "chrome" => true,
            "chromium" => true,
            "msedge" => true,
            "microsoftedge" => true,
            "brave" => true,
            "opera" => true,
            "opera_gx" => true,
            "vivaldi" => true,
            "arc" => true,
            _ => false
        };
    }

    private static bool LooksLikeGoogleFormsUrl(string? url)
    {
        return !string.IsNullOrWhiteSpace(url) &&
               (url.Contains("docs.google.com/forms", StringComparison.OrdinalIgnoreCase) ||
                url.Contains("forms.gle", StringComparison.OrdinalIgnoreCase));
    }

    private static bool LooksLikeMailUrl(string? url)
    {
        return !string.IsNullOrWhiteSpace(url) &&
               (url.Contains("mail.google.com", StringComparison.OrdinalIgnoreCase) ||
                url.Contains("outlook.live.com", StringComparison.OrdinalIgnoreCase) ||
                url.Contains("outlook.office.com", StringComparison.OrdinalIgnoreCase));
    }

    private static string BuildTakeActionRetryHint(
        string? targetUrl,
        string? currentBrowserUrl,
        bool usingExtensionBrowserSession,
        bool usingActiveBrowserSession,
        bool extensionUnavailableForCurrentTab,
        bool managedBrowserFallbackEnabled)
    {
        if (extensionUnavailableForCurrentTab)
        {
            return managedBrowserFallbackEnabled
                ? "The real current-tab browser bridge is not connected yet, so Corsiri is falling back to weaker browser automation. Reload the unpacked Corsiri extension, keep the browser open on your logged-in tab, then retry."
                : "The real current-tab browser bridge is not connected yet. Corsiri is staying out of the managed Chrome fallback, so reload the unpacked Corsiri extension, keep the browser open on your logged-in tab, then retry.";
        }

        if (usingExtensionBrowserSession)
        {
            if (LooksLikeMailUrl(targetUrl) || LooksLikeMailUrl(currentBrowserUrl))
            {
                return "Corsiri is acting through the real browser tab you already use. Keep the logged-in mail tab focused and retry once Gmail fully finishes loading.";
            }

            if (LooksLikeGoogleFormsUrl(targetUrl) || LooksLikeGoogleFormsUrl(currentBrowserUrl))
            {
                return "Corsiri is acting through the real browser tab you already use. Keep the Google Form tab open and retry once the form fully loads.";
            }

            return "Corsiri is using your real current browser tab first. Keep the target tab active and retry if the page is still loading.";
        }

        if (usingActiveBrowserSession)
        {
            if (LooksLikeMailUrl(targetUrl) || LooksLikeMailUrl(currentBrowserUrl))
            {
                return "Corsiri is trying to act inside your current logged-in browser session. Keep that mail tab open and press Take Action again if Gmail is still loading.";
            }

            if (LooksLikeGoogleFormsUrl(targetUrl) || LooksLikeGoogleFormsUrl(currentBrowserUrl))
            {
                return "Corsiri is trying to fill the form in your current browser session. Keep the form tab open and retry once the page is fully loaded.";
            }

            return "Corsiri is using your current browser session first. Keep the target tab visible and retry if the page is still loading.";
        }

        if (!managedBrowserFallbackEnabled)
        {
            return "Corsiri is set to work in your current browser session only. Keep the target tab open in your logged-in browser and connect the Chromium extension bridge for reliable DOM actions.";
        }

        if (LooksLikeMailUrl(targetUrl))
        {
            return "Corsiri opened the mail workflow in the managed Chrome window. If Gmail needs sign-in or Compose is still loading, complete that once and press Take Action again.";
        }

        if (LooksLikeGoogleFormsUrl(targetUrl) || LooksLikeGoogleFormsUrl(currentBrowserUrl))
        {
            return "Corsiri opened the form in the managed Chrome window. If the form is still loading, wait a moment and press Take Action again.";
        }

        return "Open the target workflow in the Corsiri managed Chrome window and retry.";
    }

    private async Task<AgentResponse> ReAnalyzeLastSelectionAsync(ActionDecision decision, CancellationToken cancellationToken)
    {
        var mode = ModeToProtocol(_interactionMode);
        var cursor = _cursorTracker.CurrentPosition;
        var actionHint = decision.ActionHint;
        if (!string.IsNullOrWhiteSpace(actionHint))
        {
            TrySyncActionRing(actionHint);
            OnActionExecute?.Invoke(this, ToDisplayAction(actionHint));
            _orbOverlayWindow.SetState(OrbState.Processing, $"Running {ToDisplayAction(actionHint).ToLowerInvariant()}...");
        }
        else if (!string.IsNullOrWhiteSpace(decision.DisplayAction))
        {
            _orbOverlayWindow.SetState(OrbState.Processing, $"Re-evaluating {ToDisplayAction(decision.DisplayAction!).ToLowerInvariant()}...");
        }
        else
        {
            _orbOverlayWindow.SetState(OrbState.Processing, "Analyzing selection...");
        }

        if (string.Equals(_lastSelectionContext?.Kind, "image", StringComparison.OrdinalIgnoreCase))
        {
            return await _NovaClient.AnalyzeImageAsync(
                _lastSelectionContext!.ImageBase64!,
                _lastSelectionContext.ImageMimeType!,
                actionHint,
                mode,
                _windowFocusTracker.LastExternalProcessName,
                decision.VoiceCommand,
                cursor,
                cancellationToken);
        }

        return await _NovaClient.AnalyzeTextAsync(
            _lastSelectionContext!.Text!,
            actionHint,
            mode,
            _windowFocusTracker.LastExternalProcessName,
            decision.VoiceCommand,
            cursor,
            _lastSelectionContext.ImageBase64,
            _lastSelectionContext.ImageMimeType,
            cancellationToken);
    }

    private async Task ReRunLastSelectionAsync(ActionDecision decision, CancellationToken cancellationToken)
    {
        if (_lastSelectionContext is null)
        {
            return;
        }

        if (string.Equals(_lastSelectionContext.Kind, "image", StringComparison.OrdinalIgnoreCase) &&
            (string.IsNullOrWhiteSpace(_lastSelectionContext.ImageBase64) || string.IsNullOrWhiteSpace(_lastSelectionContext.ImageMimeType)))
        {
            _resultPanelWindow.ShowInfo("Stored image context is unavailable.", _cursorTracker.CurrentPosition);
            return;
        }

        if (!string.Equals(_lastSelectionContext.Kind, "image", StringComparison.OrdinalIgnoreCase) &&
            string.IsNullOrWhiteSpace(_lastSelectionContext.Text))
        {
            _resultPanelWindow.ShowInfo("Stored text context is unavailable.", _cursorTracker.CurrentPosition);
            return;
        }

        var response = await ReAnalyzeLastSelectionAsync(decision, cancellationToken);
        var updatedContext = _lastSelectionContext with { VoiceCommand = decision.VoiceCommand };
        await CompleteSuccessfulRunAsync(response, _cursorTracker.CurrentPosition, updatedContext);
    }

    private async Task<BrowserActionPlanResponse> BuildBrowserActionPlanAsync(
        BrowserPageContext planContext,
        string selectedAction,
        string? executionInstruction,
        CancellationToken cancellationToken)
    {
        return await _NovaClient.PlanBrowserActionAsync(
            new BrowserActionPlanRequest
            {
                OriginalText = _lastSelectionContext?.Text ?? string.Empty,
                ResultText = _lastResult,
                Action = selectedAction,
                VoiceCommand = executionInstruction,
                ContentType = _lastSelectionContext?.ContentType ?? "general_text",
                BrowserContext = planContext
            },
            cancellationToken);
    }

    private static string? CombineExecutionInstruction(string? baseInstruction, string? additionalInstruction)
    {
        var trimmedAdditional = additionalInstruction?.Trim();
        if (string.IsNullOrWhiteSpace(trimmedAdditional))
        {
            return baseInstruction;
        }

        if (string.IsNullOrWhiteSpace(baseInstruction))
        {
            return trimmedAdditional;
        }

        if (baseInstruction.Contains(trimmedAdditional, StringComparison.OrdinalIgnoreCase))
        {
            return baseInstruction;
        }

        return $"{baseInstruction.Trim()}. Additional execution instruction: {trimmedAdditional}";
    }

    private static Task<ActionPlanPreviewDecision> ShowActionPlanPreviewAsync(BrowserActionPlanResponse plan, string currentAction, string? initialInstruction)
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            var preview = new ActionPlanPreviewWindow(plan, currentAction, initialInstruction);
            var accepted = preview.ShowDialog() == true;
            return new ActionPlanPreviewDecision(accepted, preview.ChangeResultRequested, preview.AdditionalInstruction);
        }).Task;
    }

    private async void ResultPanelWindowOnUndoRequested(object? sender, EventArgs e)
    {
        if (_undoHistory.Count == 0)
        {
            _resultPanelWindow.ShowInfo("Nothing to undo yet.", _cursorTracker.CurrentPosition, allowTakeAction: !string.IsNullOrWhiteSpace(_lastResult));
            return;
        }

        var undoEntry = _undoHistory.Pop();
        UpdateUndoAvailability();

        try
        {
            switch (undoEntry.Target)
            {
                case UndoTarget.ExternalWindow:
                    if (undoEntry.WindowHandle != IntPtr.Zero)
                    {
                        NativeMethods.BringToFront(undoEntry.WindowHandle);
                        await Task.Delay(50);
                    }

                    NativeMethods.SendCtrlZ();
                    break;
                case UndoTarget.Browser:
                    await _browserAutomationClient.ExecutePlanAsync(
                        new BrowserActionPlanResponse
                        {
                            Goal = "undo_last_browser_action",
                            Summary = undoEntry.Description,
                            Steps =
                            [
                                new BrowserActionStep
                                {
                                    Tool = "press_key",
                                    Key = "Control+Z"
                                }
                            ]
                        },
                        CancellationToken.None);
                    break;
            }

            _orbOverlayWindow.SetState(OrbState.Completed, "Undo applied");
            _resultPanelWindow.ShowInfo(
                $"Undo applied.{Environment.NewLine}{Environment.NewLine}{undoEntry.Description}",
                _cursorTracker.CurrentPosition,
                allowTakeAction: !string.IsNullOrWhiteSpace(_lastResult));
        }
        catch (Exception ex)
        {
            _orbOverlayWindow.SetState(OrbState.Completed, "Undo failed");
            _resultPanelWindow.ShowInfo(
                $"Undo failed.{Environment.NewLine}{Environment.NewLine}{ex.Message}",
                _cursorTracker.CurrentPosition,
                allowTakeAction: !string.IsNullOrWhiteSpace(_lastResult));
        }
    }

    private void PushUndoHistory(UndoHistoryEntry entry)
    {
        _undoHistory.Push(entry);
        while (_undoHistory.Count > MaxUndoHistory)
        {
            var kept = _undoHistory.Take(MaxUndoHistory).Reverse().ToList();
            _undoHistory.Clear();
            foreach (var item in kept)
            {
                _undoHistory.Push(item);
            }
        }

        UpdateUndoAvailability();
    }

    private void UpdateUndoAvailability()
    {
        _resultPanelWindow.SetUndoAvailable(_undoHistory.Count > 0);
    }

    private async void ResultPanelWindowOnMoreOptionsRequested(object? sender, EventArgs e)
    {
        if (_lastSelectionContext is null)
        {
            _resultPanelWindow.ShowInfo("No recent selection to re-run.", _cursorTracker.CurrentPosition);
            return;
        }

        if (!await _runLock.WaitAsync(0))
        {
            return;
        }

        try
        {
            _orbOverlayWindow.MoveToTopRight();
            EnsureWindowVisible(_orbOverlayWindow);
            OnProcessingStart?.Invoke(this, EventArgs.Empty);

            var decision = await ResolveActionDecisionAsync(
                _lastSelectionContext.Suggestion,
                _lastSelectionContext.VoiceCommand,
                forceActionMenu: true,
                CancellationToken.None);

            if (decision is null)
            {
                _orbOverlayWindow.SetState(OrbState.Idle, "Action menu canceled");
                return;
            }
            await ReRunLastSelectionAsync(decision.Value, CancellationToken.None);
        }
        catch (Exception ex)
        {
            _orbOverlayWindow.SetState(OrbState.Completed, "Failed to process request");
            _resultPanelWindow.ShowInfo($"Error: {ex.Message}", _cursorTracker.CurrentPosition);
        }
        finally
        {
            _runLock.Release();
        }
    }

    private static string NormalizeActionHint(string action)
    {
        if (string.IsNullOrWhiteSpace(action))
        {
            return "summarize";
        }

        var normalized = action.Trim().ToLowerInvariant();
        normalized = normalized
            .Replace(">", string.Empty, StringComparison.Ordinal)
            .Replace("...", string.Empty, StringComparison.Ordinal)
            .Replace("-", " ", StringComparison.Ordinal);
        normalized = string.Join(" ", normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries));

        return normalized switch
        {
            "answer question" => "answer_question",
            "answer" => "answer_question",
            "summarise" => "summarize",
            "expand" => "expand_text",
            "expand text" => "expand_text",
            "bullet points" => "bullet_points",
            "extract bullet points" => "bullet_points",
            "convert to bullet points" => "bullet_points",
            "extract insights" => "extract_insights",
            "rewrite structured" => "rewrite_structured",
            "polish email" => "polish_email",
            "draft reply" => "draft_reply",
            "improve code" => "improve_code",
            "explain code" => "explain_code",
            "debug code" => "debug_code",
            "optimize code" => "optimize_code",
            "compare prices" => "compare_prices",
            "extract product info" => "extract_product_info",
            "show product details" => "show_product_details",
            "find reviews" => "find_reviews",
            "suggest captions" => "suggest_captions",
            "generate captions" => "generate_captions",
            "describe image" => "describe_image",
            "find key details" => "extract_key_details",
            "identify objects" => "identify_objects",
            "extract key details" => "extract_key_details",
            "extract dominant colors" => "extract_dominant_colors",
            "identify image colors" => "extract_dominant_colors",
            "dominant colors" => "extract_dominant_colors",
            "color palette" => "extract_dominant_colors",
            "ocr extract text" => "ocr_extract_text",
            "extract table data" => "extract_table_data",
            _ => normalized.Replace(" ", "_", StringComparison.Ordinal)
        };
    }

    private static string ToDisplayAction(string actionHint)
    {
        return NormalizeActionHint(actionHint) switch
        {
            "answer_question" => "Answer Question",
            "expand_text" => "Expand",
            "bullet_points" => "Bullet Points",
            "extract_insights" => "Extract Insights",
            "rewrite_structured" => "Rewrite Structured",
            "polish_email" => "Polish Email",
            "draft_reply" => "Draft Reply",
            "improve_code" => "Improve Code",
            "explain_code" => "Explain Code",
            "debug_code" => "Debug Code",
            "optimize_code" => "Optimize Code",
            "extract_product_info" => "Extract Product Info",
            "compare_prices" => "Compare Prices",
            "show_product_details" => "Show Product Details",
            "find_reviews" => "Find Reviews",
            "suggest_captions" => "Suggest Captions",
            "generate_captions" => "Generate Captions",
            "describe_image" => "Describe Image",
            "identify_objects" => "Identify Objects",
            "extract_key_details" => "Extract Key Details",
            "extract_dominant_colors" => "Extract Dominant Colors",
            "ocr_extract_text" => "OCR Extract Text",
            "extract_table_data" => "Extract Table Data",
            var x => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(x.Replace("_", " ", StringComparison.Ordinal))
        };
    }

    private static string ModeToProtocol(InteractionMode mode)
    {
        return mode == InteractionMode.Guided ? "guided" : "smart";
    }

    private static string ModeToDisplay(InteractionMode mode)
    {
        return mode == InteractionMode.Guided ? "Guided" : "Smart";
    }

    private static void EnsureWindowVisible(System.Windows.Window window)
    {
        if (!window.IsVisible)
        {
            window.Show();
        }
    }

    private readonly record struct ActionDecision(string? ActionHint, string? VoiceCommand, string? DisplayAction = null);

    private readonly record struct GuidedMenuOptions(IReadOnlyList<string> InitialOptions, IReadOnlyList<string> DeferredOptions);

    private readonly record struct ActionPlanPreviewDecision(bool Approved, bool ChangeResultRequested, string? AdditionalInstruction);

    private sealed record CapturedSelectionContext
    {
        public string Kind { get; init; } = "text";

        public string? Text { get; init; }

        public string? ImageBase64 { get; init; }

        public string? ImageMimeType { get; init; }

        public string ContentType { get; init; } = "general_text";

        public string? VoiceCommand { get; init; }

        public IntPtr SourceWindowHandle { get; init; } = IntPtr.Zero;

        public string? SourceProcessName { get; init; }

        public string ExecutedAction { get; init; } = string.Empty;

        public SuggestionResponse Suggestion { get; init; } = new();
    }

    private static string BuildTakeActionSummary(BrowserActionPlanResponse plan, BrowserExecutionResponse execution, ExtensionBridgeHealthResponse? extensionHealth)
    {
        var lines = new List<string>
        {
            "Take Action completed.",
            string.Empty,
            $"Plan: {plan.Summary}",
            $"Status: {execution.Message}",
            $"Steps executed: {execution.ExecutedSteps}"
        };

        if (!execution.Success && !string.IsNullOrWhiteSpace(execution.Details))
        {
            lines.Add($"Details: {execution.Details}");
        }

        if (!string.IsNullOrWhiteSpace(execution.PageContext?.Title))
        {
            lines.Add($"Page: {execution.PageContext.Title}");
        }

        if (!string.IsNullOrWhiteSpace(execution.PageContext?.Url))
        {
            lines.Add(execution.PageContext.Url);
        }

        if (execution.Logs.Count > 0)
        {
            lines.Add(string.Empty);
            lines.Add("Executed tools:");
            foreach (var log in execution.Logs.Take(8))
            {
                lines.Add($"- {log}");
            }
        }

        if (IsExtensionUnavailable(extensionHealth))
        {
            lines.Add(string.Empty);
            lines.Add("Current-tab bridge:");
            lines.Add("The Chromium extension bridge is not connected, so Corsiri fell back to weaker browser automation. Reload the unpacked extension and keep your logged-in browser tab open for best Take Action reliability.");
        }

        return string.Join(Environment.NewLine, lines);
    }

    private static bool IsExtensionUnavailable(ExtensionBridgeHealthResponse? extensionHealth)
    {
        return extensionHealth is null || !extensionHealth.Ok || !extensionHealth.ExtensionConnected;
    }

    private readonly record struct UndoHistoryEntry(UndoTarget Target, IntPtr WindowHandle, string Description);

    private enum UndoTarget
    {
        ExternalWindow,
        Browser
    }

    private static string? GetCorsiriEnv(string name)
    {
        var altName = name.StartsWith("CORSIRI_", StringComparison.OrdinalIgnoreCase)
            ? name.Replace("CORSIRI_", "CURSIVIS_", StringComparison.OrdinalIgnoreCase)
            : name.Replace("CURSIVIS_", "CORSIRI_", StringComparison.OrdinalIgnoreCase);
        return Environment.GetEnvironmentVariable(name) ?? Environment.GetEnvironmentVariable(altName);
    }

    private static bool ParseBoolEnv(string name, bool defaultValue)
    {
        var raw = GetCorsiriEnv(name);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return defaultValue;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "1" => true,
            "true" => true,
            "yes" => true,
            "on" => true,
            "0" => false,
            "false" => false,
            "no" => false,
            "off" => false,
            _ => defaultValue
        };
    }

    private static double ParseDoubleEnv(string name, double defaultValue)
    {
        var raw = GetCorsiriEnv(name);
        return double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : defaultValue;
    }

    private static int ParseIntEnv(string name, int defaultValue)
    {
        var raw = GetCorsiriEnv(name);
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : defaultValue;
    }

    private (string? ImageBase64, string? ImageMimeType) TryCaptureTextVisualContext(Point cursor)
    {
        if (!_textVisualContextEnabled)
        {
            return default;
        }

        var imageBase64 = _screenCaptureService.TryCaptureContextAroundCursorAsBase64Png(
            cursor,
            _textVisualContextWidth,
            _textVisualContextHeight);

        return string.IsNullOrWhiteSpace(imageBase64)
            ? default
            : (imageBase64, "image/png");
    }
}
