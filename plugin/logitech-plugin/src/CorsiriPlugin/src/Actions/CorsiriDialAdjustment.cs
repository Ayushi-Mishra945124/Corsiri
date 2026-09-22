namespace Loupedeck.CorsiriPlugin
{
    using System;

    public class CorsiriDialAdjustment : PluginDynamicAdjustment
    {
        public CorsiriDialAdjustment()
            : base(displayName: "Corsiri Dial", description: "Rotate to move AI Action Ring, press to execute", groupName: "Corsiri", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            try
            {
                if (diff == 0)
                {
                    return;
                }

                var delta = diff > 0 ? 1 : -1;
                TriggerIpcClient.SendAsync("dial_tick", delta).GetAwaiter().GetResult();
                PluginLog.Info($"Sent dial tick ({delta}) to companion.");
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send dial tick.");
            }
        }

        protected override void RunCommand(String actionParameter)
        {
            try
            {
                TriggerIpcClient.SendAsync("dial_press").GetAwaiter().GetResult();
                PluginLog.Info("Sent dial press to companion.");
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send dial press.");
            }
        }
    }
}
