using Corsiri.Companion.Controllers;
using Corsiri.Companion.Models;
using Corsiri.Companion.Services;
using Corsiri.Companion.Views;
using System.Threading;
using System.Windows;

namespace Corsiri.Companion;

public partial class App : Application
{
    private Mutex? _singleInstanceMutex;
    private bool _ownsSingleInstanceMutex;
    private CursorTracker? _cursorTracker;
    private WindowFocusTracker? _windowFocusTracker;
    private NovaClient? _NovaClient;
    private BrowserAutomationClient? _browserAutomationClient;
    private ExtensionAutomationClient? _extensionAutomationClient;
    private TriggerController? _triggerController;
    private OrbOverlayWindow? _orbOverlayWindow;
    private ResultPanelWindow? _resultPanelWindow;
    private TriggerIpcServer? _triggerIpcServer;
    private HapticEventHub? _hapticEventHub;
    private SettingsService? _settingsService;
    private ChatHistoryService? _chatHistoryService;
    private ChatbotWindow? _chatbotWindow;
    private CorsiriFloatingPopup? _corsiriFloatingPopup;
    private CancellationTokenSource? _ipcLongPressCts;
    private Task? _ipcLongPressTask;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ShutdownMode = ShutdownMode.OnMainWindowClose;
        var logFile = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Corsiri", "companion.log");
        try { System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(logFile)!); System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] Startup initiated\n"); } catch {}

        AppDomain.CurrentDomain.UnhandledException += (s, args) =>
        {
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] AppDomain UnhandledException: {args.ExceptionObject}\n"); } catch {}
        };
        DispatcherUnhandledException += (s, args) =>
        {
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] DispatcherUnhandledException: {args.Exception}\n"); } catch {}
        };
        TaskScheduler.UnobservedTaskException += (s, args) =>
        {
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] TaskScheduler UnobservedTaskException: {args.Exception}\n"); } catch {}
        };

        _singleInstanceMutex = new Mutex(true, @"Local\Corsiri.Companion.SingleInstance", out var createdNew);
        _ownsSingleInstanceMutex = createdNew;
        if (!createdNew)
        {
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] Single instance mutex already owned - exiting\n"); } catch {}
            MessageBox.Show(
                "Corsiri Companion is already running.\nUse the existing MX Creative Console Demo window.",
                "Corsiri",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown(0);
            return;
        }

        try
        {
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] Loading settings...\n"); } catch {}
            _settingsService = new SettingsService();
            var mode = await _settingsService.TryLoadModeAsync() ?? InteractionMode.Smart;
            await _settingsService.SaveModeAsync(mode);
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] Settings loaded: {mode}\n"); } catch {}

            var clipboardService = new ClipboardService();
            var intentMemoryService = new IntentMemoryService();
            _cursorTracker = new CursorTracker();
            _windowFocusTracker = new WindowFocusTracker();
            var selectionDetector = new SelectionDetector(clipboardService);
            var lassoSelectionService = new LassoSelectionService();
            var screenCaptureService = new ScreenCaptureService();
            _NovaClient = new NovaClient();
            _browserAutomationClient = new BrowserAutomationClient();
            _extensionAutomationClient = new ExtensionAutomationClient();
            var activeBrowserAutomationService = new ActiveBrowserAutomationService(clipboardService);
            var voiceCaptureService = new VoiceCaptureService();
            var voiceCommandPromptService = new VoiceCommandPromptService(_NovaClient, voiceCaptureService);
            _orbOverlayWindow = new OrbOverlayWindow();
            _resultPanelWindow = new ResultPanelWindow();

            _chatHistoryService = new ChatHistoryService();
            _chatbotWindow = new ChatbotWindow(_NovaClient, clipboardService, _chatHistoryService);
            _corsiriFloatingPopup = new CorsiriFloatingPopup(_NovaClient, clipboardService, voiceCaptureService);

            _triggerController = new TriggerController(
                _cursorTracker,
                selectionDetector,
                _orbOverlayWindow,
                _resultPanelWindow,
                clipboardService,
                _NovaClient,
                _browserAutomationClient,
                _extensionAutomationClient,
                activeBrowserAutomationService,
                lassoSelectionService,
                screenCaptureService,
                voiceCommandPromptService,
                _windowFocusTracker,
                intentMemoryService,
                mode,
                _corsiriFloatingPopup,
                _chatbotWindow);

            var mainWindow = new MainWindow(_triggerController, _settingsService, mode);
            MainWindow = mainWindow;

            _windowFocusTracker.RegisterCompanionWindow(mainWindow);
            _windowFocusTracker.RegisterCompanionWindow(_orbOverlayWindow);
            _windowFocusTracker.RegisterCompanionWindow(_resultPanelWindow);
            _windowFocusTracker.RegisterCompanionWindow(_corsiriFloatingPopup);
            _windowFocusTracker.RegisterCompanionWindow(_chatbotWindow);

            _orbOverlayWindow.Show();
            _orbOverlayWindow.Hide();
            _resultPanelWindow.Show();
            _resultPanelWindow.Hide();
            mainWindow.Show();
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] mainWindow.Show() called\n"); } catch {}

            _cursorTracker.Start();
            _windowFocusTracker.Start();
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] Trackers started\n"); } catch {}

            try
            {
                _triggerIpcServer = new TriggerIpcServer();
                _triggerIpcServer.TriggerReceived += TriggerIpcServerOnTriggerReceived;
                _triggerIpcServer.Start();
                try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] TriggerIpcServer started\n"); } catch {}
            }
            catch (Exception ipcEx)
            {
                try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] TriggerIpcServer error: {ipcEx}\n"); } catch {}
                _resultPanelWindow.ShowInfo(
                    $"Trigger IPC unavailable: {ipcEx.Message}",
                    new Point(40, 40));
            }

            try
            {
                _hapticEventHub = new HapticEventHub();
                _hapticEventHub.Start();
                _triggerController.OnActionChange += TriggerControllerOnActionChange;
                _triggerController.OnActionExecute += TriggerControllerOnActionExecute;
                _triggerController.OnProcessingStart += TriggerControllerOnProcessingStart;
                _triggerController.OnProcessingComplete += TriggerControllerOnProcessingComplete;
                try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] HapticEventHub started\n"); } catch {}
            }
            catch (Exception hapticEx)
            {
                try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] HapticEventHub error: {hapticEx}\n"); } catch {}
                _resultPanelWindow.ShowInfo(
                    $"Haptic channel unavailable: {hapticEx.Message}",
                    new Point(40, 80));
            }
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] OnStartup completed without exception\n"); } catch {}
        }
        catch (Exception ex)
        {
            try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] Startup Exception: {ex}\n"); } catch {}
            MessageBox.Show(
                $"Companion startup failed:\n{ex.Message}",
                "Corsiri",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(-1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        var logFile = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Corsiri", "companion.log");
        try { System.IO.File.AppendAllText(logFile, $"[{DateTime.UtcNow:o}] OnExit invoked (ExitCode: {e.ApplicationExitCode})\n"); } catch {}
        _triggerController?.Dispose();
        _cursorTracker?.Dispose();
        _windowFocusTracker?.Dispose();
        if (_triggerIpcServer is not null)
        {
            _triggerIpcServer.TriggerReceived -= TriggerIpcServerOnTriggerReceived;
            _triggerIpcServer.Dispose();
        }

        if (_triggerController is not null)
        {
            _triggerController.OnActionChange -= TriggerControllerOnActionChange;
            _triggerController.OnActionExecute -= TriggerControllerOnActionExecute;
            _triggerController.OnProcessingStart -= TriggerControllerOnProcessingStart;
            _triggerController.OnProcessingComplete -= TriggerControllerOnProcessingComplete;
        }

        _hapticEventHub?.Dispose();
        CancelIpcLongPress();

        if (_singleInstanceMutex is not null)
        {
            if (_ownsSingleInstanceMutex)
            {
                try
                {
                    _singleInstanceMutex.ReleaseMutex();
                }
                catch
                {
                    // Ignore release race on shutdown.
                }
            }

            _singleInstanceMutex.Dispose();
        }

        _NovaClient?.Dispose();
        _browserAutomationClient?.Dispose();
        _extensionAutomationClient?.Dispose();
        _corsiriFloatingPopup?.Close();
        _chatbotWindow?.Close();
        base.OnExit(e);
    }

    private async void TriggerIpcServerOnTriggerReceived(object? sender, TriggerEventPayload e)
    {
        if (_triggerController is null)
        {
            return;
        }

        try
        {
            await Dispatcher.InvokeAsync(() =>
            {
                var pressType = e.PressType.Trim().ToLowerInvariant();
                switch (pressType)
                {
                    case "tap":
                        _ = _triggerController.HandleTapAsync(CancellationToken.None);
                        break;
                    case "long_press":
                        _ = _triggerController.HandleLongPressAsync(CancellationToken.None);
                        break;
                    case "long_press_start":
                        StartIpcLongPress();
                        break;
                    case "long_press_end":
                        _ = CompleteIpcLongPressAsync();
                        break;
                    case "dial_press":
                        _ = _triggerController.HandleDialPressAsync(CancellationToken.None);
                        break;
                    case "dial_tick":
                        _triggerController.HandleDialTick(e.DialDelta ?? 1);
                        break;
                }
            });
        }
        catch
        {
            // Keep app running even if an external IPC event is malformed.
        }
    }

    private void StartIpcLongPress()
    {
        if (_triggerController is null)
        {
            return;
        }

        if (_ipcLongPressTask is not null && !_ipcLongPressTask.IsCompleted)
        {
            return;
        }

        CancelIpcLongPress();
        _ipcLongPressCts = new CancellationTokenSource();
        _ipcLongPressTask = _triggerController.HandleLongPressAsync(_ipcLongPressCts.Token);
    }

    private async Task CompleteIpcLongPressAsync()
    {
        if (_ipcLongPressTask is null)
        {
            return;
        }

        CancelIpcLongPress();
        try
        {
            await _ipcLongPressTask;
        }
        catch
        {
            // Errors are surfaced via companion UI.
        }
        finally
        {
            _ipcLongPressCts?.Dispose();
            _ipcLongPressCts = null;
            _ipcLongPressTask = null;
        }
    }

    private void CancelIpcLongPress()
    {
        try
        {
            _ipcLongPressCts?.Cancel();
        }
        catch
        {
            // Ignore cancellation race.
        }
    }

    private async void TriggerControllerOnActionChange(object? sender, string action)
    {
        await PublishHapticAsync("action_change", "light", ("action", action));
    }

    private async void TriggerControllerOnActionExecute(object? sender, string action)
    {
        await PublishHapticAsync("action_execute", "medium", ("action", action));
    }

    private async void TriggerControllerOnProcessingStart(object? sender, EventArgs e)
    {
        await PublishHapticAsync("processing_start", "light");
    }

    private async void TriggerControllerOnProcessingComplete(object? sender, EventArgs e)
    {
        await PublishHapticAsync("processing_complete", "strong");
    }

    private async Task PublishHapticAsync(string hapticType, string intensity, params (string Key, string Value)[] metadataEntries)
    {
        if (_hapticEventHub is null)
        {
            return;
        }

        var metadata = metadataEntries.Length == 0
            ? null
            : metadataEntries.ToDictionary(x => x.Key, x => x.Value);
        await _hapticEventHub.BroadcastAsync(new HapticEventPayload
        {
            HapticType = hapticType,
            Intensity = intensity,
            Metadata = metadata,
            TimestampUtc = DateTime.UtcNow.ToString("O")
        });
    }
}
