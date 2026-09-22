namespace Loupedeck.CorsiriPlugin
{
    using System;

    public class CorsiriLongPressStartCommand : PluginDynamicCommand
    {
        public CorsiriLongPressStartCommand()
            : base(displayName: "Corsiri Long Press Start", description: "Send long press start trigger to companion", groupName: "Corsiri")
        {
        }

        protected override void RunCommand(String actionParameter)
        {
            try
            {
                TriggerIpcClient.SendAsync("long_press_start").GetAwaiter().GetResult();
                PluginLog.Info("Sent long press start trigger to companion.");
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send long press start trigger.");
            }
        }
    }
}
