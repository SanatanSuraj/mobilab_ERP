/**
 * Notifications module barrel. ARCHITECTURE.md §13.7 (Phase 2) + §3.6 (Phase 3).
 *
 * Phase 2 primitives:
 *   - NotificationTemplatesService (templates library CRUD)
 *   - NotificationsService         (per-user inbox)
 *
 * Phase 3 dispatcher:
 *   - DispatcherService            (template routing + channel fan-out)
 *   - notificationDispatchDlqRepo  (DLQ for failed sends)
 *   - renderTemplate               ({{var}} helper, exported for tests)
 */

export { NotificationsService } from "./notifications.service.js";
export { NotificationTemplatesService } from "./templates.service.js";
export { notificationsRepo } from "./notifications.repository.js";
export { notificationTemplatesRepo } from "./templates.repository.js";

export {
  DispatcherService,
  renderTemplate,
  type DispatcherServiceOptions,
  type DispatcherCallContext,
  type EmailSender,
  type WhatsAppSendAdapter,
} from "./dispatcher.service.js";

export {
  notificationDispatchDlqRepo,
  type EnqueueDispatchDlqInput,
  type ListDispatchDlqFilters,
} from "./dispatch.repository.js";
