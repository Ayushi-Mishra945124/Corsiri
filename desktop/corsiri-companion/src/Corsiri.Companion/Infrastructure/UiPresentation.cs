using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Corsiri.Companion.Infrastructure;

public static class UiPresentation
{
    public static void ApplyShinyText(TextBlock target, Color baseColor, Color shineColor, double speedSeconds = 2.2)
    {
        var brush = new LinearGradientBrush
        {
            StartPoint = new Point(0, 0),
            EndPoint = new Point(1, 0),
            MappingMode = BrushMappingMode.RelativeToBoundingBox,
            RelativeTransform = new TranslateTransform(1.35, 0)
        };

        brush.GradientStops.Add(new GradientStop(baseColor, 0.0));
        brush.GradientStops.Add(new GradientStop(baseColor, 0.32));
        brush.GradientStops.Add(new GradientStop(shineColor, 0.5));
        brush.GradientStops.Add(new GradientStop(baseColor, 0.68));
        brush.GradientStops.Add(new GradientStop(baseColor, 1.0));

        target.Foreground = brush;

        if (brush.RelativeTransform is TranslateTransform transform)
        {
            transform.BeginAnimation(
                TranslateTransform.XProperty,
                new DoubleAnimation
                {
                    From = 1.35,
                    To = -1.35,
                    Duration = TimeSpan.FromSeconds(speedSeconds),
                    RepeatBehavior = RepeatBehavior.Forever
                });
        }
    }

    public static void SetFlatText(TextBlock target, Color color)
    {
        target.Foreground = new SolidColorBrush(color);
    }

    public static void AnimateEntrance(FrameworkElement target, TranslateTransform translateTransform, double fromY = 16, double durationMs = 260)
    {
        target.Opacity = 0;
        translateTransform.Y = fromY;

        target.BeginAnimation(
            UIElement.OpacityProperty,
            new DoubleAnimation
            {
                From = 0,
                To = 1,
                Duration = TimeSpan.FromMilliseconds(durationMs),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            });

        translateTransform.BeginAnimation(
            TranslateTransform.YProperty,
            new DoubleAnimation
            {
                From = fromY,
                To = 0,
                Duration = TimeSpan.FromMilliseconds(durationMs),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            });
    }

    public static async Task RevealTextAsync(TextBlock target, string text, CancellationToken cancellationToken)
    {
        var normalized = text ?? string.Empty;
        target.Text = string.Empty;

        if (string.IsNullOrWhiteSpace(normalized))
        {
            return;
        }

        var stride = Math.Clamp(normalized.Length / 140, 1, 18);
        var delay = normalized.Length > 1800 ? 5 : normalized.Length > 700 ? 8 : 12;

        for (var index = 0; index < normalized.Length; index += stride)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var length = Math.Min(normalized.Length, index + stride);
            target.Text = normalized[..length];
            await Task.Delay(delay, cancellationToken);
        }

        target.Text = normalized;
    }
}
