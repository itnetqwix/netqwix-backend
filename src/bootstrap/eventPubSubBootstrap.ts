import { log } from "../../logger";
import { registerDomainEventHandlers } from "../handlers/domainEventHandlers";
import {
  bootstrapEventPubSub,
  registerPubSubHandler,
  type PubSubEnvelope,
} from "../services/eventPubSub";
import { deliverSocketEvent } from "../services/socketEventBridge";

const logger = log.getLogger();
let bootstrapped = false;

/**
 * Wire Redis (or local) pub/sub → Socket.IO delivery on every API instance.
 */
export async function bootstrapEventPubSubBridge(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  registerDomainEventHandlers();

  registerPubSubHandler((envelope: PubSubEnvelope) => {
    deliverSocketEvent(envelope);
  });

  await bootstrapEventPubSub();
  logger.info("[PubSub] Socket + domain handlers ready");
}
