using Corsiri.Companion.Models;
using System.IO;
using System.Text.Json;

namespace Corsiri.Companion.Services;

public sealed class ChatHistoryService
{
    private readonly string _storagePath;
    private readonly object _lock = new();

    public ChatHistoryService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var dir = Path.Combine(appData, "Corsiri", "ChatHistory");
        Directory.CreateDirectory(dir);
        _storagePath = Path.Combine(dir, "conversations.json");

        var legacyPath = Path.Combine(appData, "Cursivis", "ChatHistory", "conversations.json");
        if (!File.Exists(_storagePath) && File.Exists(legacyPath))
        {
            try
            {
                File.Copy(legacyPath, _storagePath, overwrite: false);
            }
            catch {}
        }
    }

    public async Task<List<ChatSession>> LoadSessionsAsync()
    {
        return await Task.Run(() =>
        {
            lock (_lock)
            {
                if (!File.Exists(_storagePath))
                {
                    return new List<ChatSession>();
                }

                try
                {
                    var json = File.ReadAllText(_storagePath);
                    var sessions = JsonSerializer.Deserialize<List<ChatSession>>(json);
                    return sessions?.OrderByDescending(s => s.UpdatedAtUtc).ToList() ?? new List<ChatSession>();
                }
                catch
                {
                    return new List<ChatSession>();
                }
            }
        });
    }

    public async Task SaveSessionAsync(ChatSession session)
    {
        await Task.Run(() =>
        {
            lock (_lock)
            {
                var sessions = new List<ChatSession>();
                if (File.Exists(_storagePath))
                {
                    try
                    {
                        var json = File.ReadAllText(_storagePath);
                        sessions = JsonSerializer.Deserialize<List<ChatSession>>(json) ?? new List<ChatSession>();
                    }
                    catch
                    {
                        sessions = new List<ChatSession>();
                    }
                }

                session.UpdatedAtUtc = DateTime.UtcNow;
                var index = sessions.FindIndex(s => s.Id == session.Id);
                if (index >= 0)
                {
                    sessions[index] = session;
                }
                else
                {
                    sessions.Insert(0, session);
                }

                var updatedJson = JsonSerializer.Serialize(sessions, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_storagePath, updatedJson);
            }
        });
    }

    public async Task DeleteSessionAsync(string sessionId)
    {
        await Task.Run(() =>
        {
            lock (_lock)
            {
                if (!File.Exists(_storagePath))
                {
                    return;
                }

                try
                {
                    var json = File.ReadAllText(_storagePath);
                    var sessions = JsonSerializer.Deserialize<List<ChatSession>>(json) ?? new List<ChatSession>();
                    sessions.RemoveAll(s => s.Id == sessionId);
                    var updatedJson = JsonSerializer.Serialize(sessions, new JsonSerializerOptions { WriteIndented = true });
                    File.WriteAllText(_storagePath, updatedJson);
                }
                catch
                {
                    // Ignore transient storage read/write errors
                }
            }
        });
    }

    public async Task RenameSessionAsync(string sessionId, string newTitle)
    {
        await Task.Run(() =>
        {
            lock (_lock)
            {
                if (!File.Exists(_storagePath))
                {
                    return;
                }

                try
                {
                    var json = File.ReadAllText(_storagePath);
                    var sessions = JsonSerializer.Deserialize<List<ChatSession>>(json) ?? new List<ChatSession>();
                    var session = sessions.FirstOrDefault(s => s.Id == sessionId);
                    if (session is not null)
                    {
                        session.Title = newTitle;
                        session.UpdatedAtUtc = DateTime.UtcNow;
                        var updatedJson = JsonSerializer.Serialize(sessions, new JsonSerializerOptions { WriteIndented = true });
                        File.WriteAllText(_storagePath, updatedJson);
                    }
                }
                catch
                {
                    // Ignore transient storage errors
                }
            }
        });
    }

    public static string GenerateTitleFromMessage(string userMessage)
    {
        if (string.IsNullOrWhiteSpace(userMessage))
        {
            return "New Conversation";
        }

        var clean = userMessage.Trim().Replace("\r", " ").Replace("\n", " ");
        if (clean.Length > 36)
        {
            return clean.Substring(0, 33) + "...";
        }

        return clean;
    }
}
