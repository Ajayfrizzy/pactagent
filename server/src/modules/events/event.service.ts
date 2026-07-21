import { notFound } from '../../common/errors/app-error';
import { serializeEvent } from './event.model';
import { tenantContext } from '../../common/tenancy/tenant-context';
import * as eventRepository from './event.repository';

export async function publishEvent(appId: string, params: Parameters<typeof eventRepository.createEvent>[1]) {
  return eventRepository.createEvent(tenantContext(appId), params);
}

export async function listAppEvents(appId: string, params: {
  type?: string;
  agreementId?: string;
  limit: number;
  cursor?: string;
}) {
  const events = await eventRepository.listEventsForApp(tenantContext(appId), params);
  const hasMore = events.length > params.limit;
  const data = events.slice(0, params.limit);

  return {
    data: data.map(serializeEvent),
    pagination: {
      limit: params.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

export async function getAppEvent(appId: string, eventId: string) {
  const event = await eventRepository.findEventForApp(tenantContext(appId), eventId);
  if (!event) {
    throw notFound('Event not found.', 'event_not_found');
  }

  return serializeEvent(event);
}
