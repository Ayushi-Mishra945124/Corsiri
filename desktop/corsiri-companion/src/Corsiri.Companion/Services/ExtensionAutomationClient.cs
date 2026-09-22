using Corsiri.Companion.Models;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace Corsiri.Companion.Services;

public sealed class ExtensionAutomationClient : IDisposable
{
    private readonly HttpClient _httpClient;

    public ExtensionAutomationClient()
    {
        var bridgeUrl = Environment.GetEnvironmentVariable("CORSIRI_EXTENSION_BRIDGE_URL")
            ?? Environment.GetEnvironmentVariable("CURSIVIS_EXTENSION_BRIDGE_URL")
            ?? "http://127.0.0.1:48830";

        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(bridgeUrl),
            Timeout = TimeSpan.FromSeconds(20)
        };
    }

    public async Task<ExtensionBridgeHealthResponse?> TryGetHealthAsync(CancellationToken cancellationToken)
    {
        try
        {
            var response = await _httpClient.GetAsync("/health", cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            return await response.Content.ReadFromJsonAsync<ExtensionBridgeHealthResponse>(cancellationToken: cancellationToken);
        }
        catch
        {
            return null;
        }
    }

    public async Task<ExtensionPageContextResponse?> TryGetActiveTabContextAsync(CancellationToken cancellationToken)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync("/active-tab-context", new { }, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            return await response.Content.ReadFromJsonAsync<ExtensionPageContextResponse>(cancellationToken: cancellationToken);
        }
        catch
        {
            return null;
        }
    }

    public async Task<BrowserExecutionResponse> ExecutePlanAsync(BrowserActionPlanResponse plan, CancellationToken cancellationToken)
    {
        var response = await _httpClient.PostAsJsonAsync(
            "/execute-plan",
            new BrowserExecutionRequest
            {
                Steps = plan.Steps
            },
            cancellationToken);

        return await ReadJsonOrThrowAsync<BrowserExecutionResponse>(response, cancellationToken);
    }

    public void Dispose()
    {
        _httpClient.Dispose();
    }

    private static async Task<T> ReadJsonOrThrowAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(FormatError(response.StatusCode, body));
        }

        var parsed = JsonSerializer.Deserialize<T>(body);
        if (parsed is null)
        {
            throw new InvalidOperationException("Extension bridge returned an empty payload.");
        }

        return parsed;
    }

    private static string FormatError(HttpStatusCode statusCode, string responseBody)
    {
        try
        {
            var parsed = JsonSerializer.Deserialize<BridgeErrorResponse>(responseBody);
            if (parsed is not null && !string.IsNullOrWhiteSpace(parsed.Error))
            {
                return parsed.Error;
            }
        }
        catch
        {
            // Fall back to the raw response below.
        }

        return $"Extension bridge error {(int)statusCode}: {responseBody}";
    }

    private sealed class BridgeErrorResponse
    {
        public string? Error { get; init; }
    }
}
