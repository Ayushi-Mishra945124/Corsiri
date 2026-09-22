using System.Text.Json.Serialization;

namespace Corsiri.Companion.Models;

public sealed class ChatMessage
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    [JsonPropertyName("role")]
    public string Role { get; set; } = "user"; // "user" or "assistant"

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("timestampUtc")]
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("contextText")]
    public string? ContextText { get; set; }

    [JsonIgnore]
    public bool IsUser => string.Equals(Role, "user", StringComparison.OrdinalIgnoreCase);

    [JsonIgnore]
    public bool HasContext => !string.IsNullOrWhiteSpace(ContextText);
}

public sealed class ChatSession
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    [JsonPropertyName("title")]
    public string Title { get; set; } = "New Conversation";

    [JsonPropertyName("createdAtUtc")]
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("updatedAtUtc")]
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("messages")]
    public List<ChatMessage> Messages { get; set; } = new();

    [JsonIgnore]
    public string FormattedTime => UpdatedAtUtc.ToLocalTime().ToString("MMM dd, h:mm tt");
}

public sealed class ChatApiResponse
{
    [JsonPropertyName("reply")]
    public string Reply { get; set; } = string.Empty;

    [JsonPropertyName("model")]
    public string? Model { get; set; }

    [JsonPropertyName("isFallback")]
    public bool IsFallback { get; set; }

    [JsonPropertyName("errorNote")]
    public string? ErrorNote { get; set; }
}
