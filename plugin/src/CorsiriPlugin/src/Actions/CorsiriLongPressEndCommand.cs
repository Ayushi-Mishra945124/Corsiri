namespace Loupedeck.CorsiriPlugin
{
    using System;

    public class CorsiriLongPressEndCommand : PluginDynamicCommand
    {
        public CorsiriLongPressEndCommand()
            : base(displayName: "Corsiri Long Press End", description: "Send long press end trigger to companion", groupName: "Corsiri")
        {
        }

        protected override void RunCommand(String actionParameter)
        {
            try
            {
                TriggerIpcClient.SendAsync("long_press_end").GetAwaiter().GetResult();
                PluginLog.Info("Sent long press end trigger to companion.");
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send long press end trigger.");
            }
        }
    }
}
