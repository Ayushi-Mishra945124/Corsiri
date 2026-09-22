using Corsiri.Companion.Models;
using System.IO;
using System.Text.Json;

namespace Corsiri.Companion.Services;

public sealed class SettingsService
{
    private const string SettingsFileName = "settings.json";
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _settingsDir;
    private readonly string _settingsPath;

    public SettingsService()
    {
        _settingsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Corsiri");
        _settingsPath = Path.Combine(_settingsDir, SettingsFileName);

        var legacyDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cursivis");
        var legacyPath = Path.Combine(legacyDir, SettingsFileName);
        if (!File.Exists(_settingsPath) && File.Exists(legacyPath))
        {
            try
            {
                Directory.CreateDirectory(_settingsDir);
                File.Copy(legacyPath, _settingsPath, overwrite: false);
            }
            catch {}
        }
    }

    public async Task<InteractionMode?> TryLoadModeAsync()
    {
        if (!File.Exists(_settingsPath))
        {
            return null;
        }

        var json = await File.ReadAllTextAsync(_settingsPath);
        var settings = JsonSerializer.Deserialize<SettingsData>(json, _jsonOptions);
        if (settings is null)
        {
            return null;
        }

        return Enum.TryParse<InteractionMode>(settings.Mode, true, out var mode) ? mode : null;
    }

    public async Task SaveModeAsync(InteractionMode mode)
    {
        Directory.CreateDirectory(_settingsDir);
        var payload = new SettingsData { Mode = mode.ToString() };
        var json = JsonSerializer.Serialize(payload, _jsonOptions);
        await File.WriteAllTextAsync(_settingsPath, json);
    }

    private sealed class SettingsData
    {
        public string Mode { get; set; } = InteractionMode.Smart.ToString();
    }
}
