namespace Corsiri.Companion.Models;

public sealed class LassoSelectionResult
{
    public required System.Windows.Int32Rect Region { get; init; }

    public bool IsCanceled { get; init; }
}
