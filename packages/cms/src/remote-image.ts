import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import {
  isBlockedAddress,
  MAX_PHOTO_BYTES,
  sniffPhotoType,
  type PhotoType,
} from '@civicscope/core';
import { CmsError } from './errors';

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/**
 * DNS lookup that refuses internal addresses. It runs at connect time, so the
 * address checked is the address connected to (no DNS-rebinding gap).
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const list = addresses as unknown as LookupAddress[];
    const blocked = list.find((a) => isBlockedAddress(a.address));
    if (blocked || list.length === 0) {
      return callback(new BlockedAddressError(), '', 0);
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    }
    callback(null, list[0]!.address, list[0]!.family);
  });
};

class BlockedAddressError extends Error {
  code = 'EBLOCKED';
}

function getOnce(
  url: URL,
): Promise<{ status: number; location?: string; body?: Buffer; type?: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { 'user-agent': 'CivicScopePhotoFetcher/1.0', accept: 'image/*' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location });
        }
        if (status !== 200) {
          res.resume();
          return resolve({ status });
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > MAX_PHOTO_BYTES) {
          res.destroy();
          return reject(new CmsError('That image is larger than 5 MB.'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PHOTO_BYTES) {
            res.destroy();
            reject(new CmsError('That image is larger than 5 MB.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status, body: Buffer.concat(chunks), type: res.headers['content-type'] }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new CmsError('The image took too long to download.')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Downloads an image from a public https address for CivicScope to keep its own
 * copy. Refuses internal network addresses (including after redirects), anything
 * over 5 MB, and anything that isn't really a JPEG, PNG or WebP image.
 */
export async function downloadImage(
  rawUrl: string,
): Promise<{ bytes: Buffer; contentType: PhotoType; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CmsError('Enter the image’s full https:// address.');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:') throw new CmsError('Only https:// image links can be used.');
    if (url.username || url.password) throw new CmsError('That link can’t be used.');
    // An IP address in the URL skips DNS lookup entirely, so check it here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isBlockedAddress(host)) {
      throw new CmsError('That address points to a private network and can’t be used.');
    }
    let res;
    try {
      res = await getOnce(url);
    } catch (error) {
      if (error instanceof CmsError) throw error;
      if (error instanceof BlockedAddressError) {
        throw new CmsError('That address points to a private network and can’t be used.');
      }
      throw new CmsError('Couldn’t download that image. Check the link, or upload the file.');
    }
    if (res.location) {
      url = new URL(res.location, url);
      continue;
    }
    if (!res.body) {
      throw new CmsError(`The link answered with an error (${res.status}). Check the address.`);
    }
    const contentType = sniffPhotoType(res.body);
    if (!contentType) throw new CmsError('That link isn’t a JPEG, PNG or WebP image.');
    return { bytes: res.body, contentType, finalUrl: url.toString() };
  }
  throw new CmsError('That link redirects too many times.');
}
