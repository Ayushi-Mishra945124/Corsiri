using Corsiri.Companion.Infrastructure;
using System.Windows;
using System.Windows.Controls.Primitives;

namespace Corsiri.Companion.Views;

public partial class ResultPanelWindow : Window
{
    private bool _isUserPositioned;
    private bool _hasInitialPlacement;
    private CancellationTokenSource? _revealCts;

    public ResultPanelWindow()
    {
        InitializeComponent();
        UiPresentation.ApplyShinyText(ActionText, ColorFromHex("#E4B4FF"), ColorFromHex("#FFFFFF"), 2.6);
    }

    public event EventHandler? CopyRequested;

    public event EventHandler? InsertRequested;

    public event EventHandler? MoreOptionsRequested;

    public event EventHandler? TakeActionRequested;

    public event EventHandler? UndoRequested;

    public string LastResult { get; private set; } = string.Empty;

    public void ShowResult(string action, string output, Point cursor)
    {
        LastResult = output;
        TitleText.Text = "AI Result";
        ActionText.Text = $"Action: {action}";
        TakeActionButton.IsEnabled = true;
        TakeActionButton.Visibility = Visibility.Visible;

        PositionPanel(cursor);
        EnsureShown();
        StartPresentation(output, animateText: true);
    }

    public void SetUndoAvailable(bool isAvailable)
    {
        UndoButton.IsEnabled = isAvailable;
    }

    public void ShowInfo(string text, Point cursor, bool allowTakeAction = false)
    {
        LastResult = text;
        TitleText.Text = "Corsiri";
        ActionText.Text = allowTakeAction ? "Action: Take Action Status" : "Action: System Status";
        TakeActionButton.IsEnabled = allowTakeAction;
        TakeActionButton.Visibility = allowTakeAction ? Visibility.Visible : Visibility.Collapsed;

        PositionPanel(cursor);
        EnsureShown();
        StartPresentation(text, animateText: false);
    }

    private void CopyButton_OnClick(object sender, RoutedEventArgs e)
    {
        CopyRequested?.Invoke(this, EventArgs.Empty);
    }

    private void InsertButton_OnClick(object sender, RoutedEventArgs e)
    {
        InsertRequested?.Invoke(this, EventArgs.Empty);
    }

    private void MoreOptionsButton_OnClick(object sender, RoutedEventArgs e)
    {
        MoreOptionsRequested?.Invoke(this, EventArgs.Empty);
    }

    private void TakeActionButton_OnClick(object sender, RoutedEventArgs e)
    {
        TakeActionRequested?.Invoke(this, EventArgs.Empty);
    }

    private void UndoButton_OnClick(object sender, RoutedEventArgs e)
    {
        UndoRequested?.Invoke(this, EventArgs.Empty);
    }

    private void PositionPanel(Point cursor)
    {
        if (_isUserPositioned)
        {
            return;
        }

        if (!_hasInitialPlacement)
        {
            _hasInitialPlacement = true;
            Left = cursor.X + 55;
            Top = cursor.Y + 65;
        }

        var workArea = SystemParameters.WorkArea;
        Left = Math.Max(workArea.Left + 8, Math.Min(Left, workArea.Right - Width - 8));
        Top = Math.Max(workArea.Top + 8, Math.Min(Top, workArea.Bottom - Height - 8));
    }

    private void DragHeader_OnMouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.LeftButton != System.Windows.Input.MouseButtonState.Pressed)
        {
            return;
        }

        _isUserPositioned = true;
        try
        {
            DragMove();
        }
        catch
        {
            // Ignore drag interruption.
        }
    }

    private void EnsureShown()
    {
        if (!IsVisible)
        {
            Show();
        }
    }

    private void StartPresentation(string body, bool animateText)
    {
        UiPresentation.AnimateEntrance(RootCard, PanelTranslateTransform, fromY: 18, durationMs: 280);
        _ = PresentBodyAsync(body, animateText);
    }

    private async Task PresentBodyAsync(string body, bool animateText)
    {
        _revealCts?.Cancel();
        _revealCts?.Dispose();
        _revealCts = new CancellationTokenSource();
        var cancellationToken = _revealCts.Token;

        try
        {
            ResultScrollViewer.ScrollToHome();
            if (animateText)
            {
                await UiPresentation.RevealTextAsync(ResultBodyText, body, cancellationToken);
            }
            else
            {
                ResultBodyText.Text = body;
            }
        }
        catch (OperationCanceledException)
        {
            ResultBodyText.Text = body;
        }
    }

    private static System.Windows.Media.Color ColorFromHex(string value)
    {
        return (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(value);
    }

    private void ResizeThumb_OnDragDelta(object sender, DragDeltaEventArgs e)
    {
        Width = Math.Max(MinWidth, Width + e.HorizontalChange);
        Height = Math.Max(MinHeight, Height + e.VerticalChange);
    }
}
