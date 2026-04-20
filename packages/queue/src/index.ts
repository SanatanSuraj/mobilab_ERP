/**
 * @mobilab/queue — BullMQ factory backed by redis-bull.
 * ARCHITECTURE.md §8.
 */

export { QueueNames, type QueueName } from "./queue-names.js";
export { createBullConnection } from "./connection.js";
export {
  makeQueue,
  makeWorker,
  makeQueueEvents,
  type MakeQueueOptions,
  type MakeWorkerOptions,
} from "./factory.js";
