using Corsiri.Companion.Infrastructure;
using Corsiri.Companion.Models;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace Corsiri.Companion.Views;

public partial class OrbOverlayWindow : Window
{
    private readonly Border[] _actionChips;
    private readonly TextBlock[] _actionTexts;
    private readonly Ellipse[] _magicRings;
    private Storyboard? _pulseStoryboard;
    private Storyboard? _rotationStoryboard;
    private Storyboard? _completionStoryboard;
    private readonly DispatcherTimer _actionRingHideTimer;
    private OrbState _currentState = OrbState.Idle;
    private bool _isUserPositioned;
    private bool _hasPosition;
    private bool _isActionRingVisible;

    public OrbOverlayWindow()
    {
        InitializeComponent();

        _actionChips =
        [
            ActionChipTop,
            ActionChipUpperRight,
            ActionChipLowerRight,
            ActionChipLowerLeft,
            ActionChipUpperLeft
        ];

        _actionTexts =
        [
            ActionTopText,
            ActionUpperRightText,
            ActionLowerRightText,
            ActionLowerLeftText,
            ActionUpperLeftText
        ];

        _magicRings =
        [
            MagicRing1,
            MagicRing2,
            MagicRing3,
            MagicRing4
        ];

        foreach (var ring in _magicRings)
        {
            ring.RenderTransformOrigin = new Point(0.5, 0.5);
            ring.RenderTransform = new ScaleTransform(0.72, 0.72);
        }

        foreach (var chip in _actionChips)
        {
            chip.Visibility = Visibility.Collapsed;
            chip.Opacity = 0;
        }

        _actionRingHideTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(1250)
        };
        _actionRingHideTimer.Tick += (_, _) => HideActionRing();

        UiPresentation.ApplyShinyText(StatusText, ColorFromHex("#AFC6DA"), Colors.White, 2.4);
        ResetListeningLevelVisual();
        ApplyPalette(OrbState.Idle);
    }

    public void MoveNearCursor(Point cursor)
    {
        if (!_hasPosition)
        {
            MoveToTopRight();
        }
    }

    public void MoveToTopRight(bool force = false)
    {
        if (_isUserPositioned && !force)
        {
            return;
        }

        var workArea = SystemParameters.WorkArea;
        Left = workArea.Right - Width - 20;
        Top = workArea.Top + 20;
        _hasPosition = true;
    }

    public void SetState(OrbState state, string status)
    {
        _currentState = state;
        StateText.Text = state.ToString();
        StatusText.Text = status;
        ApplyPalette(state);

        switch (state)
        {
            case OrbState.Processing:
                StartPulse(isListening: false);
                break;
            case OrbState.Listening:
                StartPulse(isListening: true);
                break;
            case OrbState.Completed:
                StopPulse();
                ResetListeningLevelVisual();
                PlayCompletionBurst();
                break;
            default:
                StopPulse();
                ResetListeningLevelVisual();
                break;
        }
    }

    public void SetListeningLevel(double level)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => SetListeningLevel(level));
            return;
        }

        if (_currentState != OrbState.Listening)
        {
            ResetListeningLevelVisual();
            return;
        }

        var clamped = Math.Clamp(level, 0, 1);
        VoiceGlowHalo.Opacity = 0.10 + (clamped * 0.6);
        VoiceGlowScaleTransform.ScaleX = 0.96 + (clamped * 0.82);
        VoiceGlowScaleTransform.ScaleY = 0.96 + (clamped * 0.82);
    }

    public void UpdateActionRing(IReadOnlyList<string> actions, int selectedIndex)
    {
        for (var i = 0; i < _actionChips.Length; i++)
        {
            var text = i < actions.Count ? actions[i] : string.Empty;
            _actionTexts[i].Text = text;

            var isSelected = i == selectedIndex;
            _actionChips[i].Background = isSelected
                ? CreateChipBrush(ColorFromHex("#7F0D2039"), ColorFromHex("#D03A1A5B"), ColorFromHex("#D01D4E64"))
                : CreateChipBrush(ColorFromHex("#8A0D1620"), ColorFromHex("#7A111F2D"), ColorFromHex("#7A0E1822"));
            _actionChips[i].BorderBrush = isSelected
                ? new SolidColorBrush(ColorFromHex("#FFD4EAFF"))
                : new SolidColorBrush(Color.FromArgb(72, 255, 255, 255));
            _actionTexts[i].Foreground = isSelected
                ? new SolidColorBrush(Colors.White)
                : new SolidColorBrush(ColorFromHex("#E4F3FF"));
        }
    }

    public void SetActionRingVisible(bool isVisible)
    {
        foreach (var chip in _actionChips)
        {
            AnimateActionChip(chip, isVisible);
        }

        _isActionRingVisible = isVisible;
    }

    public void ShowActionRingTemporarily()
    {
        SetActionRingVisible(true);
        _actionRingHideTimer.Stop();
        _actionRingHideTimer.Start();
    }

    public void HideActionRing()
    {
        _actionRingHideTimer.Stop();
        if (_isActionRingVisible)
        {
            SetActionRingVisible(false);
        }
    }

    private void StartPulse(bool isListening)
    {
        if (_pulseStoryboard is null)
        {
            var xAnim = new DoubleAnimation
            {
                From = 1.0,
                To = 1.05,
                Duration = TimeSpan.FromMilliseconds(620),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };

            var yAnim = xAnim.Clone();
            Storyboard.SetTarget(xAnim, OrbScaleTransform);
            Storyboard.SetTargetProperty(xAnim, new PropertyPath(ScaleTransform.ScaleXProperty));
            Storyboard.SetTarget(yAnim, OrbScaleTransform);
            Storyboard.SetTargetProperty(yAnim, new PropertyPath(ScaleTransform.ScaleYProperty));

            var glowX = new DoubleAnimation
            {
                From = 1.0,
                To = 1.16,
                Duration = TimeSpan.FromMilliseconds(760),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            var glowY = glowX.Clone();
            var glowOpacity = new DoubleAnimation
            {
                From = 0.7,
                To = 1.0,
                Duration = TimeSpan.FromMilliseconds(760),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };

            Storyboard.SetTarget(glowX, GlowScaleTransform);
            Storyboard.SetTargetProperty(glowX, new PropertyPath(ScaleTransform.ScaleXProperty));
            Storyboard.SetTarget(glowY, GlowScaleTransform);
            Storyboard.SetTargetProperty(glowY, new PropertyPath(ScaleTransform.ScaleYProperty));
            Storyboard.SetTarget(glowOpacity, GlowHalo);
            Storyboard.SetTargetProperty(glowOpacity, new PropertyPath(UIElement.OpacityProperty));

            _pulseStoryboard = new Storyboard();
            _pulseStoryboard.Children.Add(xAnim);
            _pulseStoryboard.Children.Add(yAnim);
            _pulseStoryboard.Children.Add(glowX);
            _pulseStoryboard.Children.Add(glowY);
            _pulseStoryboard.Children.Add(glowOpacity);
        }

        UiPresentation.ApplyShinyText(
            StatusText,
            isListening ? ColorFromHex("#F0C0D9") : ColorFromHex("#AFC6DA"),
            Colors.White,
            isListening ? 1.6 : 2.2);
        _pulseStoryboard.Begin();
        StartOrbitRotation(isListening ? 4.0 : 7.5);
    }

    private void StopPulse()
    {
        _pulseStoryboard?.Stop();
        _rotationStoryboard?.Stop();
        OrbScaleTransform.ScaleX = 1;
        OrbScaleTransform.ScaleY = 1;
        GlowScaleTransform.ScaleX = 1;
        GlowScaleTransform.ScaleY = 1;
        GlowHalo.Opacity = 0.9;
        UiPresentation.SetFlatText(StatusText, Colors.White);
    }

    private void ResetListeningLevelVisual()
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(ResetListeningLevelVisual);
            return;
        }

        VoiceGlowHalo.Opacity = 0;
        VoiceGlowScaleTransform.ScaleX = 0.96;
        VoiceGlowScaleTransform.ScaleY = 0.96;
    }

    private static void AnimateActionChip(Border chip, bool show)
    {
        if (show)
        {
            chip.Visibility = Visibility.Visible;
        }

        var animation = new DoubleAnimation
        {
            To = show ? 1 : 0,
            Duration = TimeSpan.FromMilliseconds(show ? 180 : 220),
            EasingFunction = new QuadraticEase
            {
                EasingMode = show ? EasingMode.EaseOut : EasingMode.EaseIn
            }
        };

        if (!show)
        {
            animation.Completed += (_, _) => chip.Visibility = Visibility.Collapsed;
        }

        chip.BeginAnimation(UIElement.OpacityProperty, animation, HandoffBehavior.SnapshotAndReplace);
    }

    private void Window_OnLoaded(object sender, RoutedEventArgs e)
    {
        MoveToTopRight();
    }

    private void OrbCore_OnMouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.LeftButton != System.Windows.Input.MouseButtonState.Pressed)
        {
            return;
        }

        _isUserPositioned = true;
        _hasPosition = true;
        try
        {
            DragMove();
        }
        catch
        {
            // Ignore drag interruptions.
        }
    }

    private void DragHandle_OnMouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        OrbCore_OnMouseLeftButtonDown(sender, e);
    }

    private void ApplyPalette(OrbState state)
    {
        switch (state)
        {
            case OrbState.Processing:
                OrbCore.Background = CreateOrbBrush(ColorFromHex("#16283A"), ColorFromHex("#122133"), ColorFromHex("#0C1621"));
                GlowHalo.Fill = CreateGlowBrush(ColorFromHex("#C255E5FF"), ColorFromHex("#48F562E7"), ColorFromHex("#0854A8FF"));
                StateText.Foreground = new SolidColorBrush(ColorFromHex("#D6E9FF"));
                break;
            case OrbState.Listening:
                OrbCore.Background = CreateOrbBrush(ColorFromHex("#331A38"), ColorFromHex("#251629"), ColorFromHex("#140E1A"));
                GlowHalo.Fill = CreateGlowBrush(ColorFromHex("#D4F562E7"), ColorFromHex("#7A5EEBFF"), ColorFromHex("#083E5C7A"));
                StateText.Foreground = new SolidColorBrush(ColorFromHex("#FFD6F8"));
                break;
            case OrbState.Completed:
                OrbCore.Background = CreateOrbBrush(ColorFromHex("#173A29"), ColorFromHex("#113021"), ColorFromHex("#0B1812"));
                GlowHalo.Fill = CreateGlowBrush(ColorFromHex("#E4FFD36A"), ColorFromHex("#685EEBFF"), ColorFromHex("#083B5A64"));
                StateText.Foreground = new SolidColorBrush(ColorFromHex("#FFF5D5"));
                break;
            default:
                OrbCore.Background = CreateOrbBrush(ColorFromHex("#172636"), ColorFromHex("#101B28"), ColorFromHex("#0B131E"));
                GlowHalo.Fill = CreateGlowBrush(ColorFromHex("#AAF562E7"), ColorFromHex("#885EEBFF"), ColorFromHex("#1065A7FF"));
                StateText.Foreground = new SolidColorBrush(ColorFromHex("#F0F7FF"));
                break;
        }
    }

    private void StartOrbitRotation(double secondsPerRotation)
    {
        _rotationStoryboard ??= new Storyboard();
        _rotationStoryboard.Stop();
        _rotationStoryboard.Children.Clear();

        var angleAnimation = new DoubleAnimation
        {
            From = OrbitRotateTransform.Angle,
            To = OrbitRotateTransform.Angle + 360,
            Duration = TimeSpan.FromSeconds(secondsPerRotation),
            RepeatBehavior = RepeatBehavior.Forever
        };

        Storyboard.SetTarget(angleAnimation, OrbitRotateTransform);
        Storyboard.SetTargetProperty(angleAnimation, new PropertyPath(RotateTransform.AngleProperty));
        _rotationStoryboard.Children.Add(angleAnimation);
        _rotationStoryboard.Begin();
    }

    private void PlayCompletionBurst()
    {
        _completionStoryboard ??= new Storyboard();
        _completionStoryboard.Stop();
        _completionStoryboard.Children.Clear();

        for (var i = 0; i < _magicRings.Length; i++)
        {
            var ring = _magicRings[i];
            ring.Opacity = 0;
            ring.Stroke = new SolidColorBrush(i % 2 == 0 ? ColorFromHex("#FFF562E7") : ColorFromHex("#FF5EEBFF"));

            if (ring.RenderTransform is not ScaleTransform scaleTransform)
            {
                scaleTransform = new ScaleTransform(0.72, 0.72);
                ring.RenderTransform = scaleTransform;
            }

            scaleTransform.ScaleX = 0.72;
            scaleTransform.ScaleY = 0.72;

            var beginTime = TimeSpan.FromMilliseconds(i * 80);
            var opacityAnimation = new DoubleAnimationUsingKeyFrames
            {
                BeginTime = beginTime
            };
            opacityAnimation.KeyFrames.Add(new DiscreteDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
            opacityAnimation.KeyFrames.Add(new LinearDoubleKeyFrame(0.9, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(160))));
            opacityAnimation.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(820))));

            var scaleAnimation = new DoubleAnimation
            {
                BeginTime = beginTime,
                From = 0.72,
                To = 1.28 + (i * 0.06),
                Duration = TimeSpan.FromMilliseconds(860),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };

            Storyboard.SetTarget(opacityAnimation, ring);
            Storyboard.SetTargetProperty(opacityAnimation, new PropertyPath(UIElement.OpacityProperty));
            Storyboard.SetTarget(scaleAnimation, scaleTransform);
            Storyboard.SetTargetProperty(scaleAnimation, new PropertyPath(ScaleTransform.ScaleXProperty));

            var scaleYAnimation = scaleAnimation.Clone();
            Storyboard.SetTarget(scaleYAnimation, scaleTransform);
            Storyboard.SetTargetProperty(scaleYAnimation, new PropertyPath(ScaleTransform.ScaleYProperty));

            _completionStoryboard.Children.Add(opacityAnimation);
            _completionStoryboard.Children.Add(scaleAnimation);
            _completionStoryboard.Children.Add(scaleYAnimation);
        }

        _completionStoryboard.Begin();
    }

    private static Brush CreateOrbBrush(Color inner, Color mid, Color outer)
    {
        return new RadialGradientBrush
        {
            GradientOrigin = new Point(0.3, 0.25),
            Center = new Point(0.5, 0.5),
            RadiusX = 0.7,
            RadiusY = 0.7,
            GradientStops =
            {
                new GradientStop(inner, 0),
                new GradientStop(mid, 0.58),
                new GradientStop(outer, 1)
            }
        };
    }

    private static Brush CreateGlowBrush(Color center, Color mid, Color outer)
    {
        return new RadialGradientBrush
        {
            GradientOrigin = new Point(0.5, 0.5),
            Center = new Point(0.5, 0.5),
            RadiusX = 0.5,
            RadiusY = 0.5,
            GradientStops =
            {
                new GradientStop(center, 0),
                new GradientStop(mid, 0.42),
                new GradientStop(outer, 1)
            }
        };
    }

    private static Brush CreateChipBrush(Color left, Color center, Color right)
    {
        return new LinearGradientBrush(
            new GradientStopCollection
            {
                new(left, 0),
                new(center, 0.5),
                new(right, 1)
            },
            new Point(0, 0),
            new Point(1, 1));
    }

    private static Color ColorFromHex(string value)
    {
        return (Color)ColorConverter.ConvertFromString(value);
    }
}
