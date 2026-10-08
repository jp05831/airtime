import { VibeClient } from "../lib/vibe/client";
import { resolveSoleAdvertiser } from "../lib/vibe/advertisers";
import { redact } from "../lib/server/http";
async function main() {
  if (!process.env.VIBE_CLIENT_ID || !process.env.VIBE_CLIENT_SECRET)
    throw Error();
  const advertiser = resolveSoleAdvertiser(
    await new VibeClient().advertisers(),
  );
  console.log(
    JSON.stringify([{ name: advertiser.name, id: advertiser.id }], null, 2),
  );
}
main().catch((error) => {
  console.error(redact(error));
  process.exitCode = 1;
});
