using Corsiri.Companion.Controllers;
using Corsiri.Companion.Infrastructure;
using Corsiri.Companion.Models;
using Corsiri.Companion.Services;
using System.Windows;
using System.Windows.Input;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Interop;

namespace Corsiri.Companion;

public partial class MainWindow : Window
{
    private const int TriggerHotkeyId = 0xCA11;
    private const int TakeActionHotkeyId = 0xCA12;
    private const int VoiceHotkeyId = 0xCA13;
    private const int WmHotKey = 0x0312;
    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private readonly TriggerController _triggerController;
    private readonly SettingsService _settingsService;
    private int _lastDialValue;
    private bool _suppressDialEvents;
    private bool _isModeInitialized;
    private CancellationTokenSource? _longPressHoldCts;
    private Task? _longPressHoldTask;
    private HwndSource? _hwndSource;

    public MainWindow(TriggerController triggerController, SettingsService settingsService, InteractionMode initialMode)
    {
        _triggerController = triggerController;
        _settingsService = settingsService;
        InitializeComponent();

        _triggerController.OnActionChange += TriggerControllerOnActionChange;
        _triggerController.OnProcessingStart += TriggerControllerOnProcessingStart;
        _triggerController.OnProcessingComplete += TriggerControllerOnProcessingComplete;
        _triggerController.OnModeChanged += TriggerControllerOnModeChanged;

        SetModeCombo(initialMode);
        _isModeInitialized = true;
        StatusText.Text = $"Status: Ready in {initialMode} mode. Press Trigger for text flow.";
        UiPresentation.ApplyShinyText(StatusText, ColorFromHex("#98B4C8"), ColorFromHex("#FFFFFF"), 2.8);
        SourceInitialized += MainWindow_OnSourceInitialized;
    }

    protected override void OnClosed(EventArgs e)
    {
        CancelLongPressSession();
        UnregisterHotkeys();
        if (_hwndSource is not null)
        {
            _hwndSource.RemoveHook(WndProc);
            _hwndSource = null;
        }

        SourceInitialized -= MainWindow_OnSourceInitialized;
        _triggerController.OnActionChange -= TriggerControllerOnActionChange;
        _triggerController.OnProcessingStart -= TriggerControllerOnProcessingStart;
        _triggerController.OnProcessingComplete -= TriggerControllerOnProcessingComplete;
        _triggerController.OnModeChanged -= TriggerControllerOnModeChanged;
        base.OnClosed(e);
    }

    private async void TriggerButton_OnClick(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Status: Trigger pressed.";
        await _triggerController.HandleTapAsync(CancellationToken.None);
    }

    private async void TakeActionButton_OnClick(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Status: Take Action pressed.";
        await _triggerController.HandleTakeActionAsync(CancellationToken.None);
    }

    private void OpenChatbotButton_OnClick(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Status: AI Chatbot opened.";
        _triggerController.OpenChatbot();
    }

    private void LongPressButton_OnMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (_longPressHoldTask is not null && !_longPressHoldTask.IsCompleted)
        {
            return;
        }

        CancelLongPressSession();
        _longPressHoldCts = new CancellationTokenSource();
        _longPressHoldTask = _triggerController.HandleLongPressAsync(_longPressHoldCts.Token);
        StatusText.Text = "Status: Listening... hold button, release to send.";
        if (sender is ButtonBase button)
        {
            button.CaptureMouse();
        }

        e.Handled = true;
    }

    private async void LongPressButton_OnMouseUp(object sender, MouseButtonEventArgs e)
    {
        await FinalizeLongPressSessionAsync();
        if (sender is ButtonBase button)
        {
            button.ReleaseMouseCapture();
        }

        e.Handled = true;
    }

    private async void LongPressButton_OnMouseLeave(object sender, MouseEventArgs e)
    {
        if (sender is not ButtonBase button || button.IsPressed)
        {
            return;
        }

        await FinalizeLongPressSessionAsync();
    }

    private async void MainWindow_OnPreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (_longPressHoldTask is null)
        {
            return;
        }

        await FinalizeLongPressSessionAsync();
    }

    private async void DialPressButton_OnClick(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Status: Image selection started.";
        await _triggerController.HandleImageSelectionAsync(CancellationToken.None);
    }

    private void ExitButton_OnClick(object sender, RoutedEventArgs e)
    {
        Application.Current.Shutdown();
    }

    private void DialSlider_OnValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_suppressDialEvents)
        {
            return;
        }

        var current = (int)e.NewValue;
        var delta = current - _lastDialValue;
        if (delta == 0)
        {
            return;
        }

        _lastDialValue = current;
        _triggerController.HandleDialTick(delta);
    }

    private void MainWindow_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape)
        {
            return;
        }

        _triggerController.CancelLassoPlaceholder();
        StatusText.Text = "Status: Lasso canceled.";
        e.Handled = true;
    }

    private void MainWindow_OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        _hwndSource = HwndSource.FromHwnd(handle);
        _hwndSource?.AddHook(WndProc);

        RegisterHotkey(handle, TriggerHotkeyId, ModControl | ModAlt, KeyInterop.VirtualKeyFromKey(Key.Space));
        RegisterHotkey(handle, TakeActionHotkeyId, ModControl | ModAlt, KeyInterop.VirtualKeyFromKey(Key.A));
        RegisterHotkey(handle, VoiceHotkeyId, ModControl | ModAlt, KeyInterop.VirtualKeyFromKey(Key.V));
    }

    private void RegisterHotkey(IntPtr handle, int id, uint modifiers, int virtualKey)
    {
        if (!NativeMethods.RegisterGlobalHotKey(handle, id, modifiers, (uint)virtualKey))
        {
            StatusText.Text = "Status: Some global hotkeys were unavailable. Buttons still work.";
        }
    }

    private void UnregisterHotkeys()
    {
        var handle = new WindowInteropHelper(this).Handle;
        NativeMethods.UnregisterGlobalHotKey(handle, TriggerHotkeyId);
        NativeMethods.UnregisterGlobalHotKey(handle, TakeActionHotkeyId);
        NativeMethods.UnregisterGlobalHotKey(handle, VoiceHotkeyId);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WmHotKey)
        {
            return IntPtr.Zero;
        }

        handled = true;
        switch (wParam.ToInt32())
        {
            case TriggerHotkeyId:
                StatusText.Text = "Status: Hotkey trigger pressed.";
                _ = _triggerController.HandleTapAsync(CancellationToken.None);
                break;
            case TakeActionHotkeyId:
                StatusText.Text = "Status: Hotkey take action pressed.";
                _ = _triggerController.HandleTakeActionAsync(CancellationToken.None);
                break;
            case VoiceHotkeyId:
                StatusText.Text = "Status: Hotkey voice pressed.";
                _ = _triggerController.HandleLongPressAsync(CancellationToken.None);
                break;
        }

        return IntPtr.Zero;
    }

    private void TriggerControllerOnActionChange(object? sender, string action)
    {
        SelectedActionText.Text = $"Selected action: {action}";
    }

    private void TriggerControllerOnProcessingStart(object? sender, EventArgs e)
    {
        StatusText.Text = "Status: Processing...";
    }

    private void TriggerControllerOnProcessingComplete(object? sender, EventArgs e)
    {
        StatusText.Text = "Status: Completed and copied.";
        _suppressDialEvents = true;
        try
        {
            _lastDialValue = 0;
            DialSlider.Value = 0;
        }
        finally
        {
            _suppressDialEvents = false;
        }
    }

    private void CancelLongPressSession()
    {
        try
        {
            _longPressHoldCts?.Cancel();
        }
        catch
        {
            // Ignore cancellation race.
        }
    }

    private async Task FinalizeLongPressSessionAsync()
    {
        if (_longPressHoldTask is null)
        {
            return;
        }

        CancelLongPressSession();
        try
        {
            await _longPressHoldTask;
        }
        catch
        {
            // Trigger controller handles its own status updates/errors.
        }
        finally
        {
            _longPressHoldCts?.Dispose();
            _longPressHoldCts = null;
            _longPressHoldTask = null;
        }
    }

    private async void ModeCombo_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_isModeInitialized)
        {
            return;
        }

        if (ModeCombo.SelectedItem is not ComboBoxItem item || item.Tag is not string tag)
        {
            return;
        }

        if (!Enum.TryParse<InteractionMode>(tag, ignoreCase: true, out var mode))
        {
            return;
        }

        _triggerController.SetInteractionMode(mode);
        await _settingsService.SaveModeAsync(mode);
        StatusText.Text = $"Status: Mode switched to {mode}.";
    }

    private void TriggerControllerOnModeChanged(object? sender, InteractionMode mode)
    {
        SetModeCombo(mode);
    }

    private void SetModeCombo(InteractionMode mode)
    {
        foreach (var item in ModeCombo.Items.OfType<ComboBoxItem>())
        {
            if (item.Tag is string tag && string.Equals(tag, mode.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                ModeCombo.SelectedItem = item;
                return;
            }
        }

        ModeCombo.SelectedIndex = 0;
    }

    private static System.Windows.Media.Color ColorFromHex(string value)
    {
        return (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(value);
    }
}
