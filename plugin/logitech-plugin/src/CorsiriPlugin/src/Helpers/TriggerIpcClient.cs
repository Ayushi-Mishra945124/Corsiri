namespace Loupedeck.CorsiriPlugin
{
    using System;
    using System.Net.WebSockets;
    using System.Text;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;

    internal static class TriggerIpcClient
    {
        private static readonly Uri PrimaryIpcUri = new Uri("ws://127.0.0.1:48711/corsiri-trigger/");
        private static readonly Uri FallbackIpcUri = new Uri("ws://127.0.0.1:48711/cursivis-trigger/");

        public static async Task SendAsync(String pressType, Int32? dialDelta = null)
        {
            using var socket = new ClientWebSocket();
            try
            {
                await socket.ConnectAsync(PrimaryIpcUri, CancellationToken.None);
            }
            catch
            {
                await socket.ConnectAsync(FallbackIpcUri, CancellationToken.None);
            }

            var payload = new
            {
                protocolVersion = "1.0.0",
                eventType = "trigger",
                requestId = Guid.NewGuid(),
                source = "logitech-plugin",
                pressType,
                dialDelta,
                cursor = new { x = 0, y = 0 },
                timestampUtc = DateTime.UtcNow.ToString("O")
            };

            var json = JsonSerializer.Serialize(payload);
            var bytes = Encoding.UTF8.GetBytes(json);
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "ok", CancellationToken.None);
        }
    }
}
