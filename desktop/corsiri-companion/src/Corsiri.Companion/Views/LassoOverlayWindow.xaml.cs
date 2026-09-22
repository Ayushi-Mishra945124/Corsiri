using Corsiri.Companion.Models;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Shapes;

namespace Corsiri.Companion.Views;

public partial class LassoOverlayWindow : Window
{
    private Point? _startPoint;
    private Rectangle _rect => SelectionRect;

    public LassoOverlayWindow()
    {
        InitializeComponent();
        Left = SystemParameters.VirtualScreenLeft;
        Top = SystemParameters.VirtualScreenTop;
        Width = SystemParameters.VirtualScreenWidth;
        Height = SystemParameters.VirtualScreenHeight;
    }

    public event EventHandler<LassoSelectionResult>? SelectionCompleted;

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        _startPoint = e.GetPosition(this);
        _rect.Visibility = Visibility.Visible;
        Canvas.SetLeft(_rect, _startPoint.Value.X);
        Canvas.SetTop(_rect, _startPoint.Value.Y);
        _rect.Width = 0;
        _rect.Height = 0;
        CaptureMouse();
    }

    private void Window_MouseMove(object sender, MouseEventArgs e)
    {
        if (_startPoint is null || e.LeftButton != MouseButtonState.Pressed)
        {
            return;
        }

        var current = e.GetPosition(this);
        var x = Math.Min(_startPoint.Value.X, current.X);
        var y = Math.Min(_startPoint.Value.Y, current.Y);
        var width = Math.Abs(current.X - _startPoint.Value.X);
        var height = Math.Abs(current.Y - _startPoint.Value.Y);

        Canvas.SetLeft(_rect, x);
        Canvas.SetTop(_rect, y);
        _rect.Width = width;
        _rect.Height = height;
    }

    private void Window_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (_startPoint is null)
        {
            return;
        }

        ReleaseMouseCapture();
        var end = e.GetPosition(this);
        var x = Math.Min(_startPoint.Value.X, end.X);
        var y = Math.Min(_startPoint.Value.Y, end.Y);
        var width = Math.Abs(end.X - _startPoint.Value.X);
        var height = Math.Abs(end.Y - _startPoint.Value.Y);
        _startPoint = null;

        if (width < 8 || height < 8)
        {
            Hide();
            SelectionCompleted?.Invoke(this, new LassoSelectionResult
            {
                IsCanceled = true,
                Region = default
            });
            Close();
            return;
        }

        var topLeft = PointToScreen(new Point(x, y));
        var bottomRight = PointToScreen(new Point(x + width, y + height));
        var absoluteX = (int)Math.Round(Math.Min(topLeft.X, bottomRight.X));
        var absoluteY = (int)Math.Round(Math.Min(topLeft.Y, bottomRight.Y));
        var absoluteWidth = (int)Math.Round(Math.Abs(bottomRight.X - topLeft.X));
        var absoluteHeight = (int)Math.Round(Math.Abs(bottomRight.Y - topLeft.Y));
        var region = new Int32Rect(absoluteX, absoluteY, absoluteWidth, absoluteHeight);

        Hide();
        SelectionCompleted?.Invoke(this, new LassoSelectionResult
        {
            IsCanceled = false,
            Region = region
        });

        Close();
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape)
        {
            return;
        }

        Hide();
        SelectionCompleted?.Invoke(this, new LassoSelectionResult
        {
            IsCanceled = true,
            Region = default
        });
        Close();
    }
}
