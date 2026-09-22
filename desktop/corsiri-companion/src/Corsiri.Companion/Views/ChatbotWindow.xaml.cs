using Corsiri.Companion.Models;
using Corsiri.Companion.Services;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;

namespace Corsiri.Companion.Views;

public partial class ChatbotWindow : Window
{
    private readonly NovaClient _novaClient;
    private readonly ClipboardService _clipboardService;
    private readonly ChatHistoryService _historyService;
    private ChatSession _currentSession;
    private string? _activeContextText;
    private bool _isCompactMode;
    private CancellationTokenSource? _sendCts;

    public ChatbotWindow(
        NovaClient novaClient,
        ClipboardService clipboardService,
        ChatHistoryService historyService)
    {
        _novaClient = novaClient;
        _clipboardService = clipboardService;
        _historyService = historyService;

        _currentSession = new ChatSession();

        InitializeComponent();
        Loaded += ChatbotWindow_OnLoaded;
    }

    private async void ChatbotWindow_OnLoaded(object sender, RoutedEventArgs e)
    {
        await RefreshSessionsListAsync();
        if (SessionsList.Items.Count > 0)
        {
            SessionsList.SelectedIndex = 0;
        }
        else
        {
            StartNewChat();
        }
    }

    public void OpenWithContext(string selectedText)
    {
        _activeContextText = selectedText?.Trim();

        // Create a new session with context
        StartNewChat();

        if (!string.IsNullOrWhiteSpace(_activeContextText))
        {
            ContextBanner.Visibility = Visibility.Visible;
            var clean = _activeContextText.Replace("\r", " ").Replace("\n", " ");
            ContextSnippetText.Text = clean.Length > 90 ? clean.Substring(0, 87) + "..." : clean;
            ContextSnippetText.ToolTip = _activeContextText;
        }

        Show();
        WindowState = WindowState.Normal;
        Activate();
        MessageInput.Focus();
    }

    private void StartNewChat()
    {
        _currentSession = new ChatSession
        {
            Title = !string.IsNullOrWhiteSpace(_activeContextText)
                ? "Context: " + ChatHistoryService.GenerateTitleFromMessage(_activeContextText)
                : "New Conversation"
        };

        RenderCurrentSession();
    }

    private async Task RefreshSessionsListAsync()
    {
        var sessions = await _historyService.LoadSessionsAsync();
        SessionsList.ItemsSource = sessions;
    }

    private void RenderCurrentSession()
    {
        MessagesPanel.Children.Clear();

        if (_currentSession.Messages.Count == 0)
        {
            WelcomeCard.Visibility = Visibility.Visible;
            MessagesPanel.Children.Add(WelcomeCard);
            return;
        }

        WelcomeCard.Visibility = Visibility.Collapsed;

        foreach (var msg in _currentSession.Messages)
        {
            AppendMessageBubble(msg);
        }

        ScrollToBottom();
    }

    private void ChatbotWindow_OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        UpdateResponsiveLayout();
    }

    private double CalculateContentFontSize()
    {
        double currentWidth = ActualWidth > 0 ? ActualWidth : 860;
        double scale = Math.Max(0, currentWidth - 800) / 1100.0;
        return Math.Clamp(14.0 + scale * 6.0, 13.5, 21.0);
    }

    private double CalculateBubbleMaxWidth()
    {
        double scrollWidth = MessagesScrollViewer?.ActualWidth > 0 ? MessagesScrollViewer.ActualWidth : (ActualWidth - 280);
        return Math.Max(560, Math.Min(1250, scrollWidth - 50));
    }

    private void UpdateResponsiveLayout()
    {
        if (MessagesPanel == null) return;
        double baseFontSize = CalculateContentFontSize();
        double maxBubbleWidth = CalculateBubbleMaxWidth();

        foreach (UIElement child in MessagesPanel.Children)
        {
            if (child is Border bubble)
            {
                bubble.MaxWidth = maxBubbleWidth;
                ApplyResponsiveFontSizes(bubble, baseFontSize);
            }
        }
    }

    private void ApplyResponsiveFontSizes(DependencyObject parent, double baseFontSize)
    {
        int count = VisualTreeHelper.GetChildrenCount(parent);
        for (int i = 0; i < count; i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is TextBlock tb)
            {
                if (tb.Tag is string tag)
                {
                    switch (tag)
                    {
                        case "header":
                            tb.FontSize = baseFontSize * 1.35;
                            break;
                        case "section":
                            tb.FontSize = baseFontSize * 1.18;
                            break;
                        case "formula":
                            tb.FontSize = baseFontSize * 1.25;
                            break;
                        case "table-cell":
                        case "content":
                            tb.FontSize = baseFontSize;
                            tb.LineHeight = baseFontSize * 1.45;
                            break;
                        case "meta":
                            tb.FontSize = Math.Max(10, baseFontSize * 0.75);
                            break;
                    }
                }
            }
            else if (child is Control ctrl && ctrl.Tag is string cTag && cTag == "meta")
            {
                ctrl.FontSize = Math.Max(10, baseFontSize * 0.75);
            }

            ApplyResponsiveFontSizes(child, baseFontSize);
        }
    }

    private void AppendMessageBubble(ChatMessage msg)
    {
        var isUser = msg.IsUser;
        double baseFontSize = CalculateContentFontSize();
        double maxBubbleWidth = CalculateBubbleMaxWidth();

        var bubbleBorder = new Border
        {
            CornerRadius = new CornerRadius(14),
            Padding = new Thickness(16, 12, 16, 12),
            Margin = new Thickness(isUser ? 40 : 0, 4, isUser ? 0 : 40, 6),
            HorizontalAlignment = isUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            Background = isUser
                ? new SolidColorBrush(Color.FromArgb(0x55, 0x17, 0x32, 0x4E))
                : new SolidColorBrush(Color.FromArgb(0x44, 0x0F, 0x1A, 0x27)),
            BorderBrush = isUser
                ? new SolidColorBrush(Color.FromArgb(0x66, 0x5E, 0xEB, 0xFF))
                : new SolidColorBrush(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF)),
            BorderThickness = new Thickness(1),
            MaxWidth = maxBubbleWidth
        };

        var stack = new StackPanel();

        // Role / Time Header
        var headerPanel = new Grid { Margin = new Thickness(0, 0, 0, 6) };
        headerPanel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerPanel.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var roleText = new TextBlock
        {
            Text = isUser ? "You" : "Corsiri Assistant",
            FontSize = Math.Max(10, baseFontSize * 0.78),
            FontWeight = FontWeights.Bold,
            Tag = "meta",
            Foreground = isUser
                ? new SolidColorBrush(Color.FromRgb(0x5E, 0xEB, 0xFF))
                : new SolidColorBrush(Color.FromRgb(0xFF, 0xD3, 0x6A))
        };
        Grid.SetColumn(roleText, 0);
        headerPanel.Children.Add(roleText);

        var timeText = new TextBlock
        {
            Text = msg.TimestampUtc.ToLocalTime().ToString("h:mm tt"),
            FontSize = Math.Max(9, baseFontSize * 0.7),
            Tag = "meta",
            Foreground = new SolidColorBrush(Color.FromRgb(0x7F, 0x97, 0xAA))
        };
        Grid.SetColumn(timeText, 1);
        headerPanel.Children.Add(timeText);
        stack.Children.Add(headerPanel);

        // Rich Formatted Content
        var contentElement = BuildRichFormattedContent(msg.Content, isUser, baseFontSize);
        stack.Children.Add(contentElement);

        // Assistant Copy Action
        if (!isUser)
        {
            var copyBtn = new Button
            {
                Content = "📋 Copy",
                FontSize = Math.Max(10, baseFontSize * 0.75),
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 8, 0, 0),
                Padding = new Thickness(8, 3, 8, 3),
                Background = Brushes.Transparent,
                BorderBrush = new SolidColorBrush(Color.FromArgb(0x44, 0x9D, 0xB6, 0xC9)),
                BorderThickness = new Thickness(1),
                Foreground = new SolidColorBrush(Color.FromRgb(0x9D, 0xB6, 0xC9)),
                Cursor = Cursors.Hand,
                Tag = "meta"
            };
            copyBtn.Click += async (s, e) =>
            {
                await _clipboardService.SetTextAsync(msg.Content);
                copyBtn.Content = "✓ Copied!";
                await Task.Delay(1200);
                copyBtn.Content = "📋 Copy";
            };
            stack.Children.Add(copyBtn);
        }

        bubbleBorder.Child = stack;
        MessagesPanel.Children.Add(bubbleBorder);
    }

    private UIElement BuildRichFormattedContent(string rawContent, bool isUser, double baseFontSize)
    {
        if (isUser)
        {
            var userText = new TextBlock
            {
                Text = rawContent,
                TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(Color.FromRgb(0xF7, 0xFB, 0xFF)),
                FontSize = baseFontSize,
                FontFamily = new FontFamily("Bahnschrift, Segoe UI"),
                LineHeight = baseFontSize * 1.45,
                Tag = "content"
            };
            return userText;
        }

        var container = new StackPanel();

        // 1. Clean meta-data & disclaimers (e.g. *(Note: ...)*)
        var cleaned = rawContent ?? "";
        cleaned = Regex.Replace(cleaned, @"\*\s*\(\s*Note:[\s\S]*?\)\s*\*", "", RegexOptions.IgnoreCase).Trim();

        var lines = cleaned.Split('\n');
        int i = 0;

        while (i < lines.Length)
        {
            var rawLine = lines[i];
            var line = rawLine.Trim();

            if (string.IsNullOrWhiteSpace(line))
            {
                container.Children.Add(new FrameworkElement { Height = 4 });
                i++;
                continue;
            }

            // Skip horizontal rule lines
            if (line == "---" || line == "***" || line == "___")
            {
                var divider = new Border
                {
                    Height = 1,
                    Background = new SolidColorBrush(Color.FromArgb(0x22, 0xFF, 0xFF, 0xFF)),
                    Margin = new Thickness(0, 8, 0, 8)
                };
                container.Children.Add(divider);
                i++;
                continue;
            }

            // 2. Table Block (lines starting and ending with |)
            if (line.StartsWith("|") && line.EndsWith("|"))
            {
                var tableLines = new List<string>();
                while (i < lines.Length && lines[i].Trim().StartsWith("|") && lines[i].Trim().EndsWith("|"))
                {
                    tableLines.Add(lines[i].Trim());
                    i++;
                }

                var tableGrid = BuildTableElement(tableLines, baseFontSize);
                if (tableGrid != null)
                {
                    container.Children.Add(tableGrid);
                }
                continue;
            }

            // 3. Header 1 / 2 (e.g. # Header or ## Header)
            if (line.StartsWith("# ") || line.StartsWith("## "))
            {
                var titleText = line.TrimStart('#').Trim();
                var headerBlock = new TextBlock
                {
                    Text = titleText,
                    FontWeight = FontWeights.Bold,
                    FontSize = baseFontSize * 1.35,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x5E, 0xEB, 0xFF)),
                    Margin = new Thickness(0, 10, 0, 6),
                    TextWrapping = TextWrapping.Wrap,
                    Tag = "header"
                };
                container.Children.Add(headerBlock);
                i++;
                continue;
            }

            // 4. Section Subheader (e.g. ### Header or 1. Quantum Physics or 2. Photoelectric Effect)
            if (line.StartsWith("### ") || Regex.IsMatch(line, @"^\d+\.\s+[A-Za-z]") && line.Length < 60)
            {
                var sectionTitle = line.StartsWith("### ") ? line.Substring(4).Trim() : line.Trim();
                sectionTitle = sectionTitle.Replace("**", "");

                var sectionBlock = new TextBlock
                {
                    Text = sectionTitle,
                    FontWeight = FontWeights.Bold,
                    FontSize = baseFontSize * 1.18,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0xDF, 0x7E)),
                    Margin = new Thickness(0, 12, 0, 4),
                    TextWrapping = TextWrapping.Wrap,
                    Tag = "section"
                };
                container.Children.Add(sectionBlock);
                i++;
                continue;
            }

            // 5. Formula / Math Equation Card
            if (IsFormulaLine(line))
            {
                var formulaCard = BuildFormulaCard(line, baseFontSize);
                container.Children.Add(formulaCard);
                i++;
                continue;
            }

            // 6. Bullet Points (- item, * item, • item)
            if (line.StartsWith("- ") || line.StartsWith("* ") || line.StartsWith("• ") || Regex.IsMatch(line, @"^\s*•\s*"))
            {
                var bulletContent = Regex.Replace(line, @"^[\s\-*•]+\s*", "");
                var bulletRow = BuildBulletRow(bulletContent, baseFontSize);
                container.Children.Add(bulletRow);
                i++;
                continue;
            }

            // 7. Regular paragraph with bold inline formatting
            var paragraphBlock = BuildInlineFormattedTextBlock(line, baseFontSize, "content");
            container.Children.Add(paragraphBlock);
            i++;
        }

        return container;
    }

    private static bool IsFormulaLine(string line)
    {
        if (line.StartsWith("$$") || line.EndsWith("$$")) return true;

        var cleaned = line.Replace("**", "").Trim();
        if (!cleaned.Contains("=") && !cleaned.Contains("≈") && !cleaned.Contains("→")) return false;

        if (Regex.IsMatch(cleaned, @"^(?:E|hf|Kmax|K_max|p|\lambda|\\lambda|F|\\vec\{F\}|B|\\vec\{B\}|c|a|v|W|U|V)\s*=", RegexOptions.IgnoreCase)) return true;
        if (Regex.IsMatch(cleaned, @"^[A-Za-zα-ωΑ-Ωλμφθ\\]+\s*=\s*[\w\s\+\-\*\/\^\(\)·×²³_]+$")) return true;

        return false;
    }

    private static Border BuildFormulaCard(string rawFormula, double baseFontSize)
    {
        var cleaned = rawFormula.Replace("$$", "").Replace("**", "").Trim();
        cleaned = CleanMathSymbols(cleaned);

        var border = new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(0x33, 0x14, 0x28, 0x3C)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(0x55, 0x5E, 0xEB, 0xFF)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(20, 8, 20, 8),
            Margin = new Thickness(0, 8, 0, 8),
            HorizontalAlignment = HorizontalAlignment.Center
        };

        var textBlock = new TextBlock
        {
            Text = cleaned,
            FontSize = baseFontSize * 1.25,
            FontFamily = new FontFamily("Cambria Math, Consolas, Bahnschrift"),
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(0x5E, 0xEB, 0xFF)),
            TextAlignment = TextAlignment.Center,
            Tag = "formula"
        };

        border.Child = textBlock;
        return border;
    }

    private static string CleanMathSymbols(string math)
    {
        return math
            .Replace(@"\phi", "φ")
            .Replace(@"\Phi", "Φ")
            .Replace(@"\lambda", "λ")
            .Replace(@"\theta", "θ")
            .Replace(@"\times", "×")
            .Replace(@"\cdot", "·")
            .Replace(@"\mu_0", "μ₀")
            .Replace(@"\epsilon_0", "ε₀")
            .Replace(@"\oint", "∮")
            .Replace(@"\vec{F}", "F")
            .Replace(@"\vec{B}", "B")
            .Replace(@"\vec{v}", "v")
            .Replace(@"^2", "²")
            .Replace(@"^3", "³")
            .Replace(@"_{max}", "max")
            .Replace(@"_1", "₁")
            .Replace(@"_2", "₂")
            .Replace(@"\frac", "")
            .Replace("{", "")
            .Replace("}", "");
    }

    private UIElement? BuildTableElement(List<string> tableLines, double baseFontSize)
    {
        var parsedRows = new List<List<string>>();
        foreach (var tLine in tableLines)
        {
            if (Regex.IsMatch(tLine, @"^\|[\s\-:]+(\|[\s\-:]+)+\|$")) continue;

            var cols = tLine.Split('|')
                .Select(c => c.Trim())
                .Where((c, idx) => idx > 0 && idx < tLine.Split('|').Length - 1)
                .ToList();

            if (cols.Count > 0)
            {
                parsedRows.Add(cols);
            }
        }

        if (parsedRows.Count == 0) return null;

        int numCols = parsedRows.Max(r => r.Count);

        var border = new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(0x22, 0x0E, 0x1A, 0x26)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(0x44, 0x5E, 0xEB, 0xFF)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(4),
            Margin = new Thickness(0, 8, 0, 8)
        };

        var grid = new Grid();
        for (int c = 0; c < numCols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < parsedRows.Count; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var rowData = parsedRows[r];
            bool isHeader = (r == 0);

            var rowBorder = new Border
            {
                Background = isHeader
                    ? new SolidColorBrush(Color.FromArgb(0x33, 0x5E, 0xEB, 0xFF))
                    : (r % 2 == 1 ? new SolidColorBrush(Color.FromArgb(0x15, 0xFF, 0xFF, 0xFF)) : Brushes.Transparent),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 1, 0, 1)
            };
            Grid.SetRow(rowBorder, r);
            Grid.SetColumnSpan(rowBorder, numCols);
            grid.Children.Add(rowBorder);

            for (int c = 0; c < rowData.Count && c < numCols; c++)
            {
                var cellText = rowData[c];
                var cellBlock = BuildInlineFormattedTextBlock(cellText, baseFontSize * (isHeader ? 1.05 : 0.98), "table-cell");
                if (isHeader) cellBlock.FontWeight = FontWeights.Bold;
                cellBlock.Margin = new Thickness(6, 4, 6, 4);

                Grid.SetRow(cellBlock, r);
                Grid.SetColumn(cellBlock, c);
                grid.Children.Add(cellBlock);
            }
        }

        border.Child = grid;
        return border;
    }

    private UIElement BuildBulletRow(string content, double baseFontSize)
    {
        var grid = new Grid { Margin = new Thickness(8, 2, 0, 2) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var bulletDot = new TextBlock
        {
            Text = "•",
            FontSize = baseFontSize * 1.15,
            Foreground = new SolidColorBrush(Color.FromRgb(0x5E, 0xEB, 0xFF)),
            VerticalAlignment = VerticalAlignment.Top,
            Tag = "content"
        };
        Grid.SetColumn(bulletDot, 0);
        grid.Children.Add(bulletDot);

        var body = BuildInlineFormattedTextBlock(content, baseFontSize, "content");
        Grid.SetColumn(body, 1);
        grid.Children.Add(body);

        return grid;
    }

    private static TextBlock BuildInlineFormattedTextBlock(string text, double fontSize, string tag)
    {
        var tb = new TextBlock
        {
            FontSize = fontSize,
            Foreground = new SolidColorBrush(Color.FromRgb(0xF0, 0xF6, 0xFC)),
            FontFamily = new FontFamily("Bahnschrift, Segoe UI"),
            TextWrapping = TextWrapping.Wrap,
            LineHeight = fontSize * 1.45,
            Margin = new Thickness(0, 2, 0, 4),
            Tag = tag
        };

        var parts = Regex.Split(text, @"(\*\*[^\*]+\*\*|\*[^\*]+\*|`[^`]+`)");
        foreach (var part in parts)
        {
            if (string.IsNullOrEmpty(part)) continue;

            if (part.StartsWith("**") && part.EndsWith("**") && part.Length > 4)
            {
                tb.Inlines.Add(new Run(part.Substring(2, part.Length - 4))
                {
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0xFF, 0xFF))
                });
            }
            else if (part.StartsWith("*") && part.EndsWith("*") && part.Length > 2)
            {
                tb.Inlines.Add(new Run(part.Substring(1, part.Length - 2))
                {
                    FontStyle = FontStyles.Italic,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xBD, 0xD7, 0xEE))
                });
            }
            else if (part.StartsWith("`") && part.EndsWith("`") && part.Length > 2)
            {
                tb.Inlines.Add(new Run(part.Substring(1, part.Length - 2))
                {
                    FontFamily = new FontFamily("Consolas"),
                    Foreground = new SolidColorBrush(Color.FromRgb(0x5E, 0xEB, 0xFF))
                });
            }
            else
            {
                tb.Inlines.Add(new Run(part));
            }
        }

        return tb;
    }

    private async void SendButton_OnClick(object sender, RoutedEventArgs e)
    {
        await SendCurrentMessageAsync();
    }

    private async void MessageInput_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
        {
            e.Handled = true;
            await SendCurrentMessageAsync();
        }
    }

    private async Task SendCurrentMessageAsync()
    {
        var text = MessageInput.Text?.Trim();
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        MessageInput.Text = string.Empty;
        WelcomeCard.Visibility = Visibility.Collapsed;

        // 1. Add User Message
        var userMsg = new ChatMessage
        {
            Role = "user",
            Content = text,
            ContextText = _activeContextText
        };
        _currentSession.Messages.Add(userMsg);
        AppendMessageBubble(userMsg);
        ScrollToBottom();

        // Update Title if this is first user message
        if (_currentSession.Messages.Count == 1)
        {
            _currentSession.Title = ChatHistoryService.GenerateTitleFromMessage(text);
        }

        // 2. Add Assistant Thinking Bubble
        var thinkingMsg = new ChatMessage
        {
            Role = "assistant",
            Content = "Thinking..."
        };
        AppendMessageBubble(thinkingMsg);
        ScrollToBottom();

        SendButton.IsEnabled = false;
        _sendCts?.Cancel();
        _sendCts = new CancellationTokenSource();

        try
        {
            var reply = await _novaClient.ChatAsync(
                _currentSession.Messages.Where(m => m != thinkingMsg).ToList(),
                _activeContextText,
                _sendCts.Token);

            // Replace thinking message with real reply
            _currentSession.Messages.Remove(thinkingMsg);
            var assistantMsg = new ChatMessage
            {
                Role = "assistant",
                Content = reply
            };
            _currentSession.Messages.Add(assistantMsg);

            // Re-render
            RenderCurrentSession();

            // Save to persistent storage
            await _historyService.SaveSessionAsync(_currentSession);
            await RefreshSessionsListAsync();
        }
        catch (OperationCanceledException)
        {
            // Canceled
        }
        catch (Exception ex)
        {
            var errorMsg = new ChatMessage
            {
                Role = "assistant",
                Content = $"Error: {ex.Message}"
            };
            _currentSession.Messages.Add(errorMsg);
            RenderCurrentSession();
        }
        finally
        {
            SendButton.IsEnabled = true;
            MessageInput.Focus();
        }
    }

    private void ScrollToBottom()
    {
        MessagesScrollViewer.ScrollToEnd();
    }

    // ── Session Sidebar Operations ────────────────────────────────────────────

    private void NewChatButton_OnClick(object sender, RoutedEventArgs e)
    {
        StartNewChat();
        MessageInput.Focus();
    }

    private void SessionsList_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SessionsList.SelectedItem is ChatSession selected)
        {
            _currentSession = selected;
            RenderCurrentSession();
        }
    }

    private async void DeleteSession_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is ChatSession session)
        {
            if (MessageBox.Show($"Delete chat \"{session.Title}\"?", "Delete Chat", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                await _historyService.DeleteSessionAsync(session.Id);
                await RefreshSessionsListAsync();
                if (_currentSession.Id == session.Id)
                {
                    StartNewChat();
                }
            }
        }
    }

    private async void RenameSession_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is ChatSession session)
        {
            var newTitle = Microsoft.VisualBasic.Interaction.InputBox("Enter new title:", "Rename Chat", session.Title);
            if (!string.IsNullOrWhiteSpace(newTitle) && newTitle != session.Title)
            {
                await _historyService.RenameSessionAsync(session.Id, newTitle.Trim());
                await RefreshSessionsListAsync();
                if (_currentSession.Id == session.Id)
                {
                    _currentSession.Title = newTitle.Trim();
                }
            }
        }
    }

    private void DismissContext_OnClick(object sender, RoutedEventArgs e)
    {
        _activeContextText = null;
        ContextBanner.Visibility = Visibility.Collapsed;
    }

    // ── Mode / Sizing Toggle ──────────────────────────────────────────────────

    private void ToggleCompactMode_OnClick(object sender, RoutedEventArgs e)
    {
        _isCompactMode = !_isCompactMode;
        if (_isCompactMode)
        {
            // Compact Mode: < 50% screen
            Width = 460;
            Height = 620;
            SidebarCol.Width = new GridLength(0); // Collapse sidebar in compact
            ModeLabel.Text = "Compact Mode";
        }
        else
        {
            // Full-size Mode
            Width = 860;
            Height = 660;
            SidebarCol.Width = new GridLength(240);
            ModeLabel.Text = "Standard Mode";
        }
    }
}
