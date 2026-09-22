using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;

namespace Corsiri.Companion.Services;

public sealed class ClipboardService
{
    public Task<IDataObject?> CaptureAsync()
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                return Clipboard.GetDataObject();
            }
            catch
            {
                return null;
            }
        }).Task;
    }

    public Task RestoreAsync(IDataObject? snapshot)
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            if (snapshot is null)
            {
                return;
            }

            try
            {
                Clipboard.SetDataObject(snapshot, true);
            }
            catch
            {
                // Intentionally ignored for demo resiliency.
            }
        }).Task;
    }

    public Task SetTextAsync(string text)
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            Clipboard.SetText(text);
        }).Task;
    }

    public Task<string?> GetTextAsync()
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                return Clipboard.ContainsText() ? Clipboard.GetText() : null;
            }
            catch
            {
                return null;
            }
        }).Task;
    }

    public Task<(string? ImageBase64, string? MimeType)> GetImageAsync()
    {
        return Application.Current.Dispatcher.InvokeAsync(() =>
        {
            try
            {
                if (!Clipboard.ContainsImage())
                {
                    return ((string?)null, (string?)null);
                }

                var image = Clipboard.GetImage();
                if (image is null)
                {
                    return ((string?)null, (string?)null);
                }

                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(image));

                using var stream = new MemoryStream();
                encoder.Save(stream);
                return (Convert.ToBase64String(stream.ToArray()), "image/png");
            }
            catch
            {
                return ((string?)null, (string?)null);
            }
        }).Task;
    }
}
