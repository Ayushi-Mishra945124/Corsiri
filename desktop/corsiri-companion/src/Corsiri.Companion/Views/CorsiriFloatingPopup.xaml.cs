using Corsiri.Companion.Models;
using Corsiri.Companion.Services;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Animation;

namespace Corsiri.Companion.Views;

public partial class CorsiriFloatingPopup : Window
{
    private readonly NovaClient _novaClient;
    private readonly ClipboardService _clipboardService;
    private readonly VoiceCaptureService _voiceCaptureService;
    private string _currentSelectedText = string.Empty;
    private string _lastAction = string.Empty;
    private string _lastVoiceInstruction = string.Empty;
    private Point _anchorPosition;
    private CancellationTokenSource? _actionCts;

    public event EventHandler<string>? OpenChatbotRequested;

    public CorsiriFloatingPopup(
        NovaClient novaClient,
        ClipboardService clipboardService,
        VoiceCaptureService voiceCaptureService)
    {
        _novaClient = novaClient;
        _clipboardService = clipboardService;
        _voiceCaptureService = voiceCaptureService;

        InitializeComponent();
        Deactivated += CorsiriFloatingPopup_OnDeactivated;
    }

    public void ShowForSelection(string selectedText, Point cursorPosition)
    {
        _currentSelectedText = selectedText.Trim();
        _anchorPosition = cursorPosition;

        // Truncate snippet preview
        var preview = _currentSelectedText.Replace("\r", " ").Replace("\n", " ");
        SelectedSnippetText.Text = preview.Length > 80 ? preview.Substring(0, 77) + "..." : preview;
        SelectedSnippetText.ToolTip = _currentSelectedText;

        // Reset to initial Menu View
        SwitchToView(MenuView);

        // Position window intelligently near cursor
        PositionNearCursor(cursorPosition);

        Show();
        Activate();

        if (FindResource("FadeInStoryboard") is Storyboard sb)
        {
            sb.Begin(this);
        }
    }

    private void PositionNearCursor(Point cursor)
    {
        // Default target position: offset slightly from cursor
        double targetX = cursor.X + 16;
        double targetY = cursor.Y + 16;

        // Determine screen bounds using system work area
        double screenLeft = SystemParameters.WorkArea.Left;
        double screenTop = SystemParameters.WorkArea.Top;
        double screenRight = SystemParameters.WorkArea.Right;
        double screenBottom = SystemParameters.WorkArea.Bottom;

        // Estimated dimensions before full render
        double estWidth = 320;
        double estHeight = 420;

        // Flip horizontally if near right screen edge
        if (targetX + estWidth > screenRight - 10)
        {
            targetX = cursor.X - estWidth - 10;
        }

        // Flip vertically if near bottom screen edge
        if (targetY + estHeight > screenBottom - 10)
        {
            targetY = cursor.Y - estHeight - 10;
        }

        // Clamp to screen bounds
        Left = Math.Max(screenLeft + 10, Math.Min(targetX, screenRight - estWidth - 10));
        Top = Math.Max(screenTop + 10, Math.Min(targetY, screenBottom - estHeight - 10));
    }

    private void SwitchToView(UIElement activeView)
    {
        MenuView.Visibility = (activeView == MenuView) ? Visibility.Visible : Visibility.Collapsed;
        TranslateView.Visibility = (activeView == TranslateView) ? Visibility.Visible : Visibility.Collapsed;
        VoiceView.Visibility = (activeView == VoiceView) ? Visibility.Visible : Visibility.Collapsed;
        ResultView.Visibility = (activeView == ResultView) ? Visibility.Visible : Visibility.Collapsed;
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private void ExplainAction_OnClick(object sender, RoutedEventArgs e)
    {
        ExecuteAiAction("explain", "Explanation");
    }

    private void SummarizeAction_OnClick(object sender, RoutedEventArgs e)
    {
        ExecuteAiAction("summarize", "Summary");
    }

    private void TranslateAction_OnClick(object sender, RoutedEventArgs e)
    {
        SwitchToView(TranslateView);
    }

    private void LangButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string lang)
        {
            ExecuteAiAction($"translate_{lang.ToLowerInvariant()}", $"Translation ({lang})");
        }
    }

    private void MoreLanguagesCombo_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (MoreLanguagesCombo.SelectedItem is ComboBoxItem item && item.Tag is string lang)
        {
            MoreLanguagesCombo.SelectedIndex = -1;
            ExecuteAiAction($"translate_{lang.ToLowerInvariant()}", $"Translation ({lang})");
        }
    }

    private void SearchAction_OnClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_currentSelectedText))
        {
            return;
        }

        var query = _currentSelectedText.Length > 200 ? _currentSelectedText.Substring(0, 197) : _currentSelectedText;
        var encoded = Uri.EscapeDataString(query.Trim());
        var searchUrl = $"https://www.google.com/search?q={encoded}";

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = searchUrl,
                UseShellExecute = true
            });
        }
        catch
        {
            // Ignore browser launch failure
        }

        // Show quick feedback in popup
        ResultTitleText.Text = "Google Search";
        ResultBodyText.Text = $"Opened Google Search in your default browser for:\n\n\"{query}\"";
        ResultLoadingPanel.Visibility = Visibility.Collapsed;
        ResultContentBorder.Visibility = Visibility.Visible;
        RegenerateButton.Visibility = Visibility.Collapsed;
        SwitchToView(ResultView);
    }

    private async void VoiceAction_OnClick(object sender, RoutedEventArgs e)
    {
        SwitchToView(VoiceView);
        VoiceInstructionInput.Text = string.Empty;
        VoiceStatusText.Text = "Listening... Speak your instruction";

        try
        {
            // Try capturing voice if input device is available
            if (_voiceCaptureService.HasInputDevice)
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                var wav = await _voiceCaptureService.CaptureWavAsync(TimeSpan.FromSeconds(5), cts.Token);
                if (wav is not null && wav.Length > 0)
                {
                    VoiceStatusText.Text = "Transcribing audio...";
                    var transcript = await _novaClient.TranscribeVoiceAsync(wav, "audio/wav", CancellationToken.None);
                    if (!string.IsNullOrWhiteSpace(transcript))
                    {
                        VoiceInstructionInput.Text = transcript;
                        VoiceStatusText.Text = "Voice captured. Press Execute or edit below:";
                        return;
                    }
                }
            }
        }
        catch
        {
            // Fallback to text instruction
        }

        VoiceStatusText.Text = "Type or refine your instruction:";
    }

    private void ExecuteVoiceCommand_OnClick(object sender, RoutedEventArgs e)
    {
        var instruction = VoiceInstructionInput.Text?.Trim();
        if (string.IsNullOrWhiteSpace(instruction))
        {
            instruction = "Explain this";
        }

        _lastVoiceInstruction = instruction;
        ExecuteAiAction("voice_command", $"Voice: \"{instruction}\"", voiceCommand: instruction);
    }

    private void ChatbotAction_OnClick(object sender, RoutedEventArgs e)
    {
        Hide();
        OpenChatbotRequested?.Invoke(this, _currentSelectedText);
    }

    private void SendToChatbotButton_OnClick(object sender, RoutedEventArgs e)
    {
        Hide();
        OpenChatbotRequested?.Invoke(this, _currentSelectedText);
    }

    // ── AI Execution & Display ────────────────────────────────────────────────

    private async void ExecuteAiAction(string action, string displayTitle, string? voiceCommand = null)
    {
        _lastAction = action;
        _actionCts?.Cancel();
        _actionCts = new CancellationTokenSource();
        var token = _actionCts.Token;

        ResultTitleText.Text = displayTitle;
        ResultBodyText.Text = string.Empty;
        ResultLoadingPanel.Visibility = Visibility.Visible;
        ResultContentBorder.Visibility = Visibility.Collapsed;
        RegenerateButton.Visibility = Visibility.Visible;
        CopyResultButton.Content = "📋 Copy";

        SwitchToView(ResultView);

        try
        {
            var response = await _novaClient.AnalyzeTextAsync(
                text: _currentSelectedText,
                actionHint: action,
                mode: "smart",
                activeApp: null,
                voiceCommand: voiceCommand,
                cursor: _anchorPosition,
                imageBase64: null,
                imageMimeType: null,
                cancellationToken: token);

            ResultLoadingPanel.Visibility = Visibility.Collapsed;
            ResultContentBorder.Visibility = Visibility.Visible;
            ResultBodyText.Text = response.Result ?? "(No result returned)";
        }
        catch (OperationCanceledException)
        {
            // Canceled by user
        }
        catch (Exception ex)
        {
            ResultLoadingPanel.Visibility = Visibility.Collapsed;
            ResultContentBorder.Visibility = Visibility.Visible;
            ResultBodyText.Text = $"Notice: {ex.Message}";
        }
    }

    private void RegenerateButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_lastAction))
        {
            ExecuteAiAction(_lastAction, ResultTitleText.Text, _lastVoiceInstruction);
        }
    }

    private async void CopyResultButton_OnClick(object sender, RoutedEventArgs e)
    {
        var text = ResultBodyText.Text;
        if (!string.IsNullOrWhiteSpace(text))
        {
            await _clipboardService.SetTextAsync(text);
            CopyResultButton.Content = "✓ Copied!";
            await Task.Delay(1400);
            CopyResultButton.Content = "📋 Copy";
        }
    }

    private void BackButton_OnClick(object sender, RoutedEventArgs e)
    {
        _actionCts?.Cancel();
        SwitchToView(MenuView);
    }

    private void CloseButton_OnClick(object sender, RoutedEventArgs e)
    {
        _actionCts?.Cancel();
        Hide();
    }

    private void Header_OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton == MouseButtonState.Pressed)
        {
            DragMove();
        }
    }

    private void Window_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            _actionCts?.Cancel();
            Hide();
            e.Handled = true;
        }
    }

    private void CorsiriFloatingPopup_OnDeactivated(object? sender, EventArgs e)
    {
        if (MoreLanguagesCombo != null && MoreLanguagesCombo.IsDropDownOpen)
        {
            return;
        }

        _actionCts?.Cancel();
        Hide();
    }
}
