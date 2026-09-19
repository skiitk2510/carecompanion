/**
 * The one APL document the skill renders on screen devices (Echo Show, the developer console's Device Display):
 * a dark card with the CareCompanion title, the spoken reply in large readable type, and a small disclaimer footer.
 *
 * Kept deliberately minimal — no imported packages, no styles, literal dp values — so it is valid on every APL
 * runtime from 2023.3 up and has nothing to fetch at render time.
 */
import type { interfaces } from 'ask-sdk-model';

export const APL_TOKEN = 'carecompanion.reply';
export const APL_TITLE = 'CareCompanion';
export const APL_FOOTER = 'Not medical advice · demo data';

export interface AplReply {
  body: string;
  title?: string;
  footer?: string;
}

/** Static document; the text comes from the `care` datasource so the document itself never changes. */
export const REPLY_DOCUMENT: Record<string, unknown> = {
  type: 'APL',
  version: '2023.3',
  theme: 'dark',
  mainTemplate: {
    parameters: ['payload'],
    items: [
      {
        type: 'Frame',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#0F172A',
        item: {
          type: 'Container',
          width: '100%',
          height: '100%',
          direction: 'column',
          paddingLeft: '48dp',
          paddingRight: '48dp',
          paddingTop: '36dp',
          paddingBottom: '24dp',
          items: [
            {
              type: 'Text',
              text: '${payload.care.title}',
              color: '#93C5FD',
              fontSize: '26dp',
              fontWeight: '700',
              paddingBottom: '14dp',
            },
            {
              type: 'ScrollView',
              grow: 1,
              shrink: 1,
              item: {
                type: 'Text',
                text: '${payload.care.body}',
                color: '#F8FAFC',
                fontSize: '38dp',
                lineHeight: 1.35,
              },
            },
            {
              type: 'Text',
              text: '${payload.care.footer}',
              color: '#94A3B8',
              fontSize: '18dp',
              paddingTop: '14dp',
            },
          ],
        },
      },
    ],
  },
};

/** APL `Text` treats `<`, `>` and `&` as markup, so the reply is escaped before it becomes a datasource value. */
export function escapeAplText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderReplyDirective(reply: AplReply): interfaces.alexa.presentation.apl.RenderDocumentDirective {
  return {
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: APL_TOKEN,
    document: REPLY_DOCUMENT,
    datasources: {
      care: {
        title: escapeAplText(reply.title ?? APL_TITLE),
        body: escapeAplText(reply.body),
        footer: escapeAplText(reply.footer ?? APL_FOOTER),
      },
    },
  };
}
