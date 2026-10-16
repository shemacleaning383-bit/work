// Safe image uploads: magic-byte sniffing (never trust the declared type),
// size caps, random server-side names, dimensions parsed from the file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Ctx } from './ctx.ts';
import { newId, now } from './db.ts';
import { UserError } from './services/projects.ts';
import { config } from './config.ts';

export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp') {
      const chunk = buf.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function saveUpload(ctx: Ctx, projectId: string, buf: Buffer, kind: 'logo' | 'photo' | 'attachment', label: string | null) {
  const type = sniffImage(buf);
  if (!type) throw new UserError('Please upload a JPEG, PNG or WebP image.', 'bad_type', 415);
  if (buf.length > config.offer.limits.maxUploadBytes) throw new UserError('That image is too large.', 'too_large', 413);
  const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM assets WHERE project_id = ? AND deleted_at IS NULL', projectId)!.n;
  if (count >= config.offer.limits.photoUploadsPerProject + 4) throw new UserError('You’ve reached the photo limit for this preview.', 'limit_uploads', 429);
  const sha = createHash('sha256').update(buf).digest('hex');
  const dup = ctx.db.get('SELECT id FROM assets WHERE project_id = ? AND sha256 = ? AND kind = ? AND deleted_at IS NULL', projectId, sha, kind);
  if (dup) return dup.id as string; // retried upload — don't store twice
  const id = newId('ast');
  const dir = join(config.dataDir, 'uploads', projectId);
  mkdirSync(dir, { recursive: true });
  const file = `${id}.${type.ext}`;
  writeFileSync(join(dir, file), buf);
  const dim = imageSize(buf, type.mime);
  ctx.db.run('INSERT INTO assets (id, project_id, kind, path, mime, bytes, width, height, source, label, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, projectId, kind, `${projectId}/${file}`, type.mime, buf.length, dim?.width ?? null, dim?.height ?? null, 'owner', label, sha, now());
  return id;
}
