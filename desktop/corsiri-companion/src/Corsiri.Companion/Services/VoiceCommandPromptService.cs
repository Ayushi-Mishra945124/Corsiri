using Corsiri.Companion.Views;
using System.Windows;

namespace Corsiri.Companion.Services;

public sealed class VoiceCommandPromptService
{
    private readonly NovaClient _NovaClient;
    private readonly VoiceCaptureService _voiceCaptureService;
    private readonly bool _enableStreamingTranscription;
    private readonly bool _requireVoiceConfirmation;
    private readonly bool _enableLiveVoiceApi;
    private readonly TimeSpan _maxVoiceDuration;
    private readonly TimeSpan _streamProbeEvery;
    private readonly TimeSpan _autoStopSilenceDuration;
    private readonly TimeSpan _initialSpeechTimeout;

    public VoiceCommandPromptService(NovaClient NovaClient, VoiceCaptureService voiceCaptureService)
    {
        _NovaClient = NovaClient;
        _voiceCaptureService = voiceCaptureService;
        _enableStreamingTranscription = ParseBoolEnv("CORSIRI_ENABLE_STREAMING_TRANSCRIPTION", defaultValue: false);
        _requireVoiceConfirmation = ParseBoolEnv("CORSIRI_VOICE_CONFIRM", defaultValue: false);
        _enableLiveVoiceApi = ParseBoolEnv("CORSIRI_ENABLE_LIVE_API_VOICE", defaultValue: false);
        _maxVoiceDuration = TimeSpan.FromSeconds(ParseIntEnv("CORSIRI_MAX_VOICE_SECONDS", defaultValue: 45, min: 5, max: 180));
        _streamProbeEvery = TimeSpan.FromSeconds(ParseIntEnv("CORSIRI_STREAM_PROBE_SECONDS", defaultValue: 2, min: 1, max: 8));
        _autoStopSilenceDuration = ResolveSilenceDuration();
        _initialSpeechTimeout = TimeSpan.FromMilliseconds(ParseIntEnv("CORSIRI_INITIAL_SPEECH_TIMEOUT_MS", defaultValue: 9000, min: 2000, max: 20000));
    }

    public async Task<string?> PromptAsync(
        Action<Models.OrbState, string>? statusChanged = null,
        Action<double>? inputLevelChanged = null,
        CancellationToken cancellationToken = default)
    {
        void Report(Models.OrbState state, string message)
        {
            statusChanged?.Invoke(state, message);
        }

        void ReportInputLevel(double level)
        {
            inputLevelChanged?.Invoke(Math.Clamp(level, 0, 1));
        }

        string? partialTranscript = null;
        string? finalTranscript = null;
        if (_voiceCaptureService.HasInputDevice)
        {
            if (_enableLiveVoiceApi)
            {
                try
                {
                    Report(Models.OrbState.Listening, "Listening... speak, then pause to submit");
                    ReportInputLevel(0);
                    await using var liveClient = new LiveVoiceCommandClient();
                    await liveClient.ConnectAsync(cancellationToken);
                    liveClient.TranscriptUpdated += (_, text) => partialTranscript = text;

                    using var session = _voiceCaptureService.CreateSession();
                    session.InputLevelChanged += OnInputLevelChanged;
                    session.ChunkAvailable += OnVoiceChunkAvailable;
                    session.Start();

                    var startedAt = DateTime.UtcNow;
                    while (!cancellationToken.IsCancellationRequested)
                    {
                        if (DateTime.UtcNow - startedAt >= _maxVoiceDuration)
                        {
                            Report(Models.OrbState.Processing, "Voice hold limit reached. Processing...");
                            break;
                        }

                        if (!session.HasDetectedSpeech &&
                            DateTime.UtcNow - startedAt >= _initialSpeechTimeout)
                        {
                            Report(Models.OrbState.Processing, "No clear speech detected yet. Checking captured audio...");
                            break;
                        }

                        if (session.HasDetectedSpeech &&
                            DateTime.UtcNow - session.LastSpeechDetectedUtc >= _autoStopSilenceDuration)
                        {
                            Report(Models.OrbState.Processing, "Speech pause detected. Processing...");
                            break;
                        }

                        await Task.Delay(100, CancellationToken.None);
                    }

                    session.InputLevelChanged -= OnInputLevelChanged;
                    session.ChunkAvailable -= OnVoiceChunkAvailable;
                    Report(Models.OrbState.Processing, "Processing voice...");
                    await session.StopAsync();
                    await liveClient.CompleteAudioAsync(CancellationToken.None);
                    finalTranscript = await liveClient.WaitForFinalTranscriptAsync(TimeSpan.FromSeconds(4), CancellationToken.None);
                    ReportInputLevel(0);

                    if (!string.IsNullOrWhiteSpace(finalTranscript) || !string.IsNullOrWhiteSpace(partialTranscript))
                    {
                        var liveTranscript = !string.IsNullOrWhiteSpace(finalTranscript) ? finalTranscript : partialTranscript;
                        if (!string.IsNullOrWhiteSpace(liveTranscript) && !_requireVoiceConfirmation)
                        {
                            Report(Models.OrbState.Completed, "Voice command ready");
                            return liveTranscript.Trim();
                        }

                        Report(Models.OrbState.Completed, "Voice captured. Review before running.");
                        return await ShowDialogAsync(
                            liveTranscript,
                            "Voice captured",
                            "Review or refine the spoken command before Corsiri runs it.");
                    }

                    void OnVoiceChunkAvailable(object? sender, VoiceChunkEventArgs args)
                    {
                        _ = liveClient.SendAudioChunkAsync(args.Data, args.MimeType, CancellationToken.None);
                    }

                    void OnInputLevelChanged(object? sender, VoiceLevelChangedEventArgs args)
                    {
                        ReportInputLevel(args.Level);
                    }
                }
                catch
                {
                    ReportInputLevel(0);
                    Report(Models.OrbState.Processing, "Realtime voice unavailable. Falling back...");
                }
            }

            try
            {
                Report(Models.OrbState.Listening, "Listening... speak now, then pause to submit");
                ReportInputLevel(0);
                using var session = _voiceCaptureService.CreateSession();
                session.InputLevelChanged += OnInputLevelChanged;
                session.Start();

                var startedAt = DateTime.UtcNow;
                var lastProbeAt = DateTime.MinValue;

                while (!cancellationToken.IsCancellationRequested)
                {
                    if (DateTime.UtcNow - startedAt >= _maxVoiceDuration)
                    {
                        break;
                    }

                    if (!session.HasDetectedSpeech &&
                        DateTime.UtcNow - startedAt >= _initialSpeechTimeout)
                    {
                        Report(Models.OrbState.Processing, "No clear speech detected yet. Checking captured audio...");
                        break;
                    }

                    if (session.HasDetectedSpeech &&
                        DateTime.UtcNow - session.LastSpeechDetectedUtc >= _autoStopSilenceDuration)
                    {
                        Report(Models.OrbState.Processing, "Speech pause detected. Processing...");
                        break;
                    }

                    await Task.Delay(150);
                    if (!_enableStreamingTranscription)
                    {
                        continue;
                    }

                    if (DateTime.UtcNow - lastProbeAt < _streamProbeEvery)
                    {
                        continue;
                    }

                    lastProbeAt = DateTime.UtcNow;
                    var snapshot = session.GetSnapshot();
                    if (snapshot is null)
                    {
                        continue;
                    }

                    try
                    {
                        var candidate = await _NovaClient.TranscribeVoiceAsync(snapshot, "audio/wav", CancellationToken.None);
                        if (!string.IsNullOrWhiteSpace(candidate))
                        {
                            partialTranscript = candidate;
                        }
                    }
                    catch
                    {
                        // Continue recording and attempt final transcription.
                    }
                }

                session.InputLevelChanged -= OnInputLevelChanged;
                var captured = await session.StopAsync();
                ReportInputLevel(0);
                if (captured is not null)
                {
                    try
                        {
                        Report(Models.OrbState.Processing, "Transcribing voice...");
                        finalTranscript = await TranscribeBufferedAudioAsync(captured);
                    }
                    catch
                    {
                        Report(Models.OrbState.Completed, "Couldn't transcribe clearly. Switching to text.");
                    }
                }

                void OnInputLevelChanged(object? sender, VoiceLevelChangedEventArgs args)
                {
                    ReportInputLevel(args.Level);
                }
            }
            catch
            {
                ReportInputLevel(0);
                Report(Models.OrbState.Completed, "Voice capture unavailable. Switching to text.");
            }
        }
        else
        {
            ReportInputLevel(0);
            Report(Models.OrbState.Completed, "No microphone detected. Type your command instead.");
        }

        var initialCommand = !string.IsNullOrWhiteSpace(finalTranscript) ? finalTranscript : partialTranscript;
        if (!string.IsNullOrWhiteSpace(initialCommand) && !_requireVoiceConfirmation)
        {
            Report(Models.OrbState.Completed, "Voice command ready");
            return initialCommand.Trim();
        }

        Report(
            Models.OrbState.Completed,
            string.IsNullOrWhiteSpace(initialCommand)
                ? "Voice input wasn't captured. Type the command instead."
                : "Voice captured. Review or refine it.");
        ReportInputLevel(0);

        return await ShowDialogAsync(
            initialCommand,
            string.IsNullOrWhiteSpace(initialCommand) ? "Voice fallback" : "Voice command ready",
            string.IsNullOrWhiteSpace(initialCommand)
                ? "Corsiri could not confidently capture a voice command this time. Type it below instead."
                : "Edit the spoken command if you want to be more specific before Corsiri runs it.");
    }

    private static Task<string?> ShowDialogAsync(string? initialCommand, string? statusTitle, string? statusMessage)
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            var dialog = new VoiceCommandWindow(initialCommand, statusTitle, statusMessage);
            var accepted = dialog.ShowDialog();
            return accepted == true ? dialog.VoiceCommand : null;
        }).Task;
    }

    private async Task<string?> TranscribeBufferedAudioAsync(byte[] captured)
    {
        var transcript = await TryTranscribeAsync(captured, "audio/wav");
        if (!string.IsNullOrWhiteSpace(transcript))
        {
            return transcript;
        }

        await Task.Delay(120);
        transcript = await TryTranscribeAsync(captured, "audio/x-wav");
        if (!string.IsNullOrWhiteSpace(transcript))
        {
            return transcript;
        }

        return await TryTranscribeAsync(captured, "audio/wave");
    }

    private async Task<string?> TryTranscribeAsync(byte[] captured, string mimeType)
    {
        try
        {
            return await _NovaClient.TranscribeVoiceAsync(captured, mimeType, CancellationToken.None);
        }
        catch
        {
            return null;
        }
    }

    private static string? GetCorsiriEnv(string name)
    {
        var primary = Environment.GetEnvironmentVariable(name);
        if (!string.IsNullOrWhiteSpace(primary))
        {
            return primary;
        }

        var fallbackName = name.StartsWith("CORSIRI_", StringComparison.OrdinalIgnoreCase)
            ? name.Replace("CORSIRI_", "CURSIVIS_", StringComparison.OrdinalIgnoreCase)
            : name.Replace("CURSIVIS_", "CORSIRI_", StringComparison.OrdinalIgnoreCase);

        return Environment.GetEnvironmentVariable(fallbackName);
    }

    private static bool ParseBoolEnv(string name, bool defaultValue)
    {
        var raw = GetCorsiriEnv(name);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return defaultValue;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "1" => true,
            "true" => true,
            "yes" => true,
            "on" => true,
            "0" => false,
            "false" => false,
            "no" => false,
            "off" => false,
            _ => defaultValue
        };
    }

    private static int ParseIntEnv(string name, int defaultValue, int min, int max)
    {
        var raw = GetCorsiriEnv(name);
        if (!int.TryParse(raw, out var parsed))
        {
            return defaultValue;
        }

        if (parsed < min)
        {
            return min;
        }

        if (parsed > max)
        {
            return max;
        }

        return parsed;
    }

    private static TimeSpan ResolveSilenceDuration()
    {
        var milliseconds = ParseIntEnv("CORSIRI_VOICE_SILENCE_MS", defaultValue: 1400, min: 600, max: 8000);
        var legacySeconds = GetCorsiriEnv("CORSIRI_VOICE_SILENCE_SECONDS");
        if (int.TryParse(legacySeconds, out var seconds))
        {
            milliseconds = Math.Clamp(seconds * 1000, 600, 8000);
        }

        return TimeSpan.FromMilliseconds(milliseconds);
    }
}
