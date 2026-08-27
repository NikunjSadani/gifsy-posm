import { Global, Module } from '@nestjs/common';
import { Msg91Service } from './msg91.service';

/**
 * Global so any domain (auth OTP, scheduled email reports, SMS/WhatsApp fan-out) can
 * inject Msg91Service. Chassis surface = the MSG91 transport only (OTP + SMTP email +
 * SMS/WhatsApp template senders). Delivery-status ingestion, templates, and the
 * notification queue are domain concerns added in later waves.
 */
@Global()
@Module({
  providers: [Msg91Service],
  exports: [Msg91Service],
})
export class NotificationsModule {}
