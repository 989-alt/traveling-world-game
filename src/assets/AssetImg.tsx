import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { assetUrl, fallbackOf, warnOnce } from './manifest';

/** 키로 그림을 그린다. 로드 실패 시 fallback 키 -> 그래도 실패하면 대체 색 블록(DESIGN §14.3). 경고는 키당 1회. */
export function AssetImg({ k, class: cls, alt = '' }: { k: string; class?: string; alt?: string }) {
  const [bad, setBad] = useState<string[]>([]);
  let key: string | undefined = k;
  while (key && bad.includes(key)) key = fallbackOf(key);
  const url = key ? assetUrl(key) : null;
  if (!key || !url) return <span class={`${cls ?? ''} asset-fallback`} role="img" aria-label={alt} style={{ background: 'var(--muted)', display: 'inline-block' }} />;
  return <img src={url} class={cls} alt={alt} decoding="async"
    onError={() => { warnOnce(key!, `로드 실패 ${url}`); setBad([...bad, key!]); }} />;
}

/** 화면 장식 그림: 못 불러오면 대체 노드(없으면 아무것도 안 그림) — 첫 화면·결과처럼 색 블록이 어색한 곳(DESIGN §14.3) */
export function Pic({ k, class: cls, alt = '', fallback = null, eager }: { k: string; class?: string; alt?: string; fallback?: ComponentChildren; eager?: boolean }) {
  const [bad, setBad] = useState(false);
  const url = assetUrl(k);
  if (bad || !url) return <>{fallback}</>;
  return <img src={url} class={cls} alt={alt} decoding="async" draggable={false} loading={eager ? 'eager' : undefined}
    onError={() => { warnOnce(k, `로드 실패 ${url}`); setBad(true); }} />;
}
