import MarkdownIt from 'markdown-it';
import sanitize from 'sanitize-html';
const parser = new MarkdownIt({ html: false, linkify: true, breaks: true });
export function markdown(value: string): string {
  return sanitize(parser.render(value), {
    allowedTags: ['p', 'br', 'strong', 'em', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'hr'],
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    transformTags: { a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
  });
}
