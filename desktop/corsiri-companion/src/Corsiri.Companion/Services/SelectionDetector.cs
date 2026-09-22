using Corsiri.Companion.Infrastructure;
using Corsiri.Companion.Models;
using System.Diagnostics;

namespace Corsiri.Companion.Services;

public sealed class SelectionDetector
{
    private readonly ClipboardService _clipboardService;

    public SelectionDetector(ClipboardService clipboardService)
    {
        _clipboardService = clipboardService;
    }

    public async Task<SelectionCaptureResult> CaptureSelectionAsync(IntPtr targetHandle, CancellationToken cancellationToken)
    {
        var backup = await _clipboardService.CaptureAsync();
        var sentinel = $"__CORSIRI_SENTINEL_{Guid.NewGuid()}__";
        string? selectedText = null;
        string? selectedImageBase64 = null;
        string? selectedImageMimeType = null;
        var resentCopy = false;

        try
        {
            await _clipboardService.SetTextAsync(sentinel);

            if (targetHandle != IntPtr.Zero)
            {
                NativeMethods.BringToFront(targetHandle);
                await Task.Delay(80, cancellationToken);
            }

            NativeMethods.SendCtrlC();

            var timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < 650)
            {
                cancellationToken.ThrowIfCancellationRequested();

                await Task.Delay(25, cancellationToken);

                if (string.IsNullOrWhiteSpace(selectedText))
                {
                    var clipboardText = await _clipboardService.GetTextAsync();
                    if (!string.IsNullOrWhiteSpace(clipboardText) &&
                        !string.Equals(clipboardText, sentinel, StringComparison.Ordinal))
                    {
                        selectedText = clipboardText;
                    }
                }

                if (string.IsNullOrWhiteSpace(selectedImageBase64))
                {
                    var clipboardImage = await _clipboardService.GetImageAsync();
                    if (!string.IsNullOrWhiteSpace(clipboardImage.ImageBase64) &&
                        !string.IsNullOrWhiteSpace(clipboardImage.MimeType))
                    {
                        selectedImageBase64 = clipboardImage.ImageBase64;
                        selectedImageMimeType = clipboardImage.MimeType;
                    }
                }

                if (!resentCopy &&
                    string.IsNullOrWhiteSpace(selectedText) &&
                    string.IsNullOrWhiteSpace(selectedImageBase64) &&
                    timer.ElapsedMilliseconds >= 240)
                {
                    NativeMethods.SendCtrlC();
                    resentCopy = true;
                }

                if (!string.IsNullOrWhiteSpace(selectedText) && !string.IsNullOrWhiteSpace(selectedImageBase64))
                {
                    break;
                }

                if (timer.ElapsedMilliseconds >= 180 &&
                    (!string.IsNullOrWhiteSpace(selectedText) || !string.IsNullOrWhiteSpace(selectedImageBase64)))
                {
                    break;
                }
            }
        }
        finally
        {
            if (string.IsNullOrWhiteSpace(selectedText) && string.IsNullOrWhiteSpace(selectedImageBase64))
            {
                await _clipboardService.RestoreAsync(backup);
            }
        }

        return new SelectionCaptureResult
        {
            Text = string.IsNullOrWhiteSpace(selectedText) ? null : selectedText,
            ImageBase64 = string.IsNullOrWhiteSpace(selectedImageBase64) ? null : selectedImageBase64,
            ImageMimeType = string.IsNullOrWhiteSpace(selectedImageMimeType) ? null : selectedImageMimeType
        };
    }

    public async Task<string?> TryCaptureSelectedTextAsync(IntPtr targetHandle, CancellationToken cancellationToken)
    {
        var selection = await CaptureSelectionAsync(targetHandle, cancellationToken);
        return selection.Text;
    }
}
