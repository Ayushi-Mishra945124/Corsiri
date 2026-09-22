namespace Loupedeck.CorsiriPlugin
{
    using System;

    public class CorsiriTriggerCommand : PluginDynamicCommand
    {
        public CorsiriTriggerCommand()
            : base(displayName: "Corsiri Trigger", description: "Send tap trigger to companion", groupName: "Corsiri")
        {
        }

        protected override void RunCommand(String actionParameter)
        {
            try
            {
                TriggerIpcClient.SendAsync("tap").GetAwaiter().GetResult();
                PluginLog.Info("Sent tap trigger to companion.");
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send tap trigger.");
            }
        }
    }
}
