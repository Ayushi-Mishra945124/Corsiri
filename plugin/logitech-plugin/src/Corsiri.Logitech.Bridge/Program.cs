using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

const string triggerEndpoint = "ws://127.0.0.1:48711/corsiri-trigger/";
const string hapticEndpoint = "ws://127.0.0.1:48712/corsiri-haptics/";

Console.WriteLine("Corsiri Logitech Bridge");
Console.WriteLine("Connecting trigger channel: " + triggerEndpoint);

using var triggerWs = new ClientWebSocket();
try
{
    await triggerWs.ConnectAsync(new Uri(triggerEndpoint), CancellationToken.None);
}
catch (Exception ex)
{
    Console.WriteLine($"Failed to connect trigger channel: {ex.Message}");
    Console.WriteLine("Start companion app first, then rerun bridge.");
    return;
}

Console.WriteLine("Connected trigger channel.");
Console.WriteLine("Connecting haptic channel: " + hapticEndpoint);
using var hapticWs = new ClientWebSocket();
Task? hapticTask = null;
try
{
    await hapticWs.ConnectAsync(new Uri(hapticEndpoint), CancellationToken.None);
    Console.WriteLine("Connected haptic channel.");
    hapticTask = Task.Run(() => ReceiveHapticsAsync(hapticWs, CancellationToken.None));
}
catch (Exception ex)
{
    Console.WriteLine($"Haptic channel unavailable ({ex.Message}). Continuing without live haptic feedback.");
}

Console.WriteLine("Keys: [T]=Tap  [L]=LongPress  [S]=LongPressStart  [E]=LongPressEnd  [P]=DialPress  [A]=DialTick -1  [D]=DialTick +1  [Q]=Quit");

while (triggerWs.State == WebSocketState.Open)
{
    var key = Console.ReadKey(intercept: true);
    if (key.Key == ConsoleKey.Q)
    {
        break;
    }

    TriggerEventPayload? payload = key.Key switch
    {
        ConsoleKey.T => BuildPayload("tap"),
        ConsoleKey.L => BuildPayload("long_press"),
        ConsoleKey.S => BuildPayload("long_press_start"),
        ConsoleKey.E => BuildPayload("long_press_end"),
        ConsoleKey.P => BuildPayload("dial_press"),
        ConsoleKey.A => BuildPayload("dial_tick", -1),
        ConsoleKey.D => BuildPayload("dial_tick", 1),
        _ => null
    };

    if (payload is null)
    {
        continue;
    }

    var json = JsonSerializer.Serialize(payload);
    var bytes = Encoding.UTF8.GetBytes(json);
    await triggerWs.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
    Console.WriteLine($"Sent: {payload.PressType}{(payload.DialDelta.HasValue ? $" ({payload.DialDelta.Value})" : string.Empty)}");
}

if (triggerWs.State == WebSocketState.Open)
{
    await triggerWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
}

if (hapticWs.State == WebSocketState.Open)
{
    await hapticWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
}

if (hapticTask is not null)
{
    await hapticTask;
}

static TriggerEventPayload BuildPayload(string pressType, int? dialDelta = null)
{
    return new TriggerEventPayload
    {
        ProtocolVersion = "1.0.0",
        EventType = "trigger",
        RequestId = Guid.NewGuid().ToString(),
        Source = "logitech-plugin",
        PressType = pressType,
        DialDelta = dialDelta,
        Cursor = new TriggerCursor { X = 0, Y = 0 },
        TimestampUtc = DateTime.UtcNow.ToString("O")
    };
}

static async Task ReceiveHapticsAsync(ClientWebSocket socket, CancellationToken cancellationToken)
{
    var buffer = new byte[4096];
    while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
    {
        using var ms = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return;
            }

            ms.Write(buffer, 0, result.Count);
        }
        while (!result.EndOfMessage);

        if (result.MessageType != WebSocketMessageType.Text)
        {
            continue;
        }

        var json = Encoding.UTF8.GetString(ms.ToArray());
        var payload = JsonSerializer.Deserialize<HapticEventPayload>(json);
        if (payload is null)
        {
            continue;
        }

        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine($"[HAPTIC] {payload.HapticType} ({payload.Intensity})");
        Console.ResetColor();

        TryConsoleBeep(payload.Intensity);
    }
}

static void TryConsoleBeep(string intensity)
{
    if (!OperatingSystem.IsWindows())
    {
        return;
    }

    try
    {
        switch (intensity?.ToLowerInvariant())
        {
            case "strong":
                Console.Beep(1200, 70);
                break;
            case "medium":
                Console.Beep(1000, 45);
                break;
            default:
                Console.Beep(800, 25);
                break;
        }
    }
    catch
    {
        // Console beep may fail on some hosts. Ignore.
    }
}

public sealed class TriggerEventPayload
{
    [JsonPropertyName("protocolVersion")]
    public string ProtocolVersion { get; set; } = "1.0.0";

    [JsonPropertyName("eventType")]
    public string EventType { get; set; } = "trigger";

    [JsonPropertyName("requestId")]
    public string RequestId { get; set; } = Guid.NewGuid().ToString();

    [JsonPropertyName("source")]
    public string Source { get; set; } = "logitech-plugin";

    [JsonPropertyName("pressType")]
    public string PressType { get; set; } = "tap";

    [JsonPropertyName("dialDelta")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? DialDelta { get; set; }

    [JsonPropertyName("cursor")]
    public TriggerCursor Cursor { get; set; } = new();

    [JsonPropertyName("timestampUtc")]
    public string TimestampUtc { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed class TriggerCursor
{
    [JsonPropertyName("x")]
    public int X { get; set; }

    [JsonPropertyName("y")]
    public int Y { get; set; }
}

public sealed class HapticEventPayload
{
    [JsonPropertyName("hapticType")]
    public string HapticType { get; set; } = "processing_start";

    [JsonPropertyName("intensity")]
    public string Intensity { get; set; } = "light";
}
