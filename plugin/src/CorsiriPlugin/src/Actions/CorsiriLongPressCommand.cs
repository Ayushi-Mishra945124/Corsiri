namespace Loupedeck.CorsiriPlugin
{
    using System;

    public class CorsiriLongPressCommand : PluginDynamicCommand
    {
        public CorsiriLongPressCommand()
            : base(displayName: "Corsiri Long Press", description: "Send long press trigger to companion", groupName: "Corsiri")
        {
        }

        protected override void RunCommand(String actionParameter)
        {
            try
            {
                TriggerIpcClient.SendAsync("long_press").GetAwaiter().GetResult();
                PluginLog.Info("Sent long press trigger to companion.");
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send long press trigger.");
            }
        }
    }
}
