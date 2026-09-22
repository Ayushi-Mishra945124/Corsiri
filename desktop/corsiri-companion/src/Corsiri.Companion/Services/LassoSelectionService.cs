using Corsiri.Companion.Models;
using Corsiri.Companion.Views;

namespace Corsiri.Companion.Services;

public sealed class LassoSelectionService
{
    public Task<LassoSelectionResult> CaptureSelectionAsync(CancellationToken cancellationToken)
    {
        var tcs = new TaskCompletionSource<LassoSelectionResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var window = new LassoOverlayWindow();
        LassoSelectionResult? pendingResult = null;

        cancellationToken.Register(() =>
        {
            if (!tcs.Task.IsCompleted)
            {
                pendingResult = new LassoSelectionResult
                {
                    IsCanceled = true,
                    Region = default
                };
                window.Dispatcher.BeginInvoke(window.Close);
            }
        });

        window.SelectionCompleted += (_, result) =>
        {
            pendingResult = result;
        };

        window.Closed += (_, _) =>
        {
            if (!tcs.Task.IsCompleted)
            {
                tcs.TrySetResult(pendingResult ?? new LassoSelectionResult
                {
                    IsCanceled = true,
                    Region = default
                });
            }
        };

        window.Show();
        window.Focus();
        return tcs.Task;
    }
}
