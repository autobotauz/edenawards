import type { RankedEntry, SeasonResults } from '../../../shared/types';
import { placeLabel } from '../../../shared/ranking';
import { plural } from '../../../shared/format';
import { Avatar, Pennants } from '../../components/ui';
import { VideoPlayer } from '../../components/Video';
import type { Slide } from './slides';

/**
 * The audience-facing slide. Contains no admin controls. Sized with container-query units so the
 * same slide fits the presenter preview and the full screen, and reads well on a projector or a Discord screen share.
 */
export function Stage({ slide, results, playKey }: { slide: Slide; results: SeasonResults; playKey: number }) {
  const cat = 'categoryIndex' in slide ? results.categories[slide.categoryIndex] : null;

  return (
    <div className="h-full w-full" style={{ containerType: 'size' }}>
    <div className="present-stage relative flex h-full w-full flex-col overflow-hidden bg-night-deep text-parchment">
      <div className="realm-rule" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgb(201_162_74/0.12),transparent_70%)]" />
      <div className="relative flex flex-1 flex-col items-center justify-center px-[5cqw] py-[4cqh] text-center">
        {slide.kind === 'intro' && (
          <div className="reveal-in">
            <Pennants className="mx-auto h-[12cqh] w-[24cqh]" />
            <p className="mt-[3cqh] font-display text-[2.4cqh] text-gold">The community presents</p>
            <h1 className="mt-[1cqh] text-[8cqh] leading-none">{results.season.name}</h1>
            <p className="mx-auto mt-[3cqh] max-w-[70cqw] text-[2.6cqh] text-parchment-dim">
              {results.categories.length} awards, voted by the players of Eden
            </p>
          </div>
        )}

        {slide.kind === 'category' && cat && (
          <div className="reveal-in">
            <p className="font-display text-[2.4cqh] text-gold">
              Award {slide.categoryIndex + 1} of {results.categories.length}
            </p>
            <h1 className="mt-[2cqh] text-[9cqh] leading-none">{cat.category.name}</h1>
            {cat.category.description && (
              <p className="mx-auto mt-[3cqh] max-w-[60cqw] text-[3cqh] text-parchment-dim">{cat.category.description}</p>
            )}
          </div>
        )}

        {slide.kind === 'empty' && cat && (
          <div className="reveal-in">
            <h1 className="text-[7cqh]">{cat.category.name}</h1>
            <p className="mt-[3cqh] text-[3cqh] text-parchment-dim">No votes were cast in this category this season.</p>
          </div>
        )}

        {slide.kind === 'nominees' && cat && (
          <div className="w-full">
            <h1 className="text-[5cqh]">{cat.category.name}</h1>
            <p className="mt-[1cqh] text-[2.4cqh] text-gold">The nominees</p>
            <ul className="mx-auto mt-[4cqh] grid max-w-[85cqw] gap-[2cqh]" style={{ gridTemplateColumns: `repeat(${Math.min(3, slide.nominees.length)}, minmax(0, 1fr))` }}>
              {slide.nominees.map((n, i) => (
                <li key={n.video.id} className="reveal-in rounded-lg border border-rim bg-keep/80 p-[1.6cqh] text-left" style={{ animationDelay: `${i * 120}ms` }}>
                  <Thumb entry={n} />
                  <p className="mt-[1.2cqh] truncate text-[2.4cqh] font-bold">{n.video.title}</p>
                  <p className="flex items-center gap-2 text-[2cqh] text-parchment-dim">
                    <Avatar user={n.video.author} size={24} /> {n.video.author.displayName}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {slide.kind === 'reveal' && cat && (
          <div className="w-full">
            <h1 className="text-[5cqh]">{cat.category.name}</h1>
            <div className="mx-auto mt-[5cqh] flex max-w-[90cqw] flex-col-reverse items-stretch gap-[2.5cqh]">
              {slide.places.slice(0, slide.revealed).map((place, i) => {
                const isNew = i === slide.revealed - 1;
                return (
                  <div
                    key={place.rank}
                    className={`${isNew ? 'reveal-place' : ''} rounded-xl border px-[3cqh] py-[2.2cqh] ${
                      place.rank === 1 ? 'border-gold bg-gold/10' : 'border-rim bg-keep/80'
                    }`}
                  >
                    <p className={`font-display ${place.rank === 1 ? 'text-[3.4cqh] text-gold-bright' : 'text-[2.6cqh] text-gold'}`}>
                      {placeLabel(place.rank, place.entries.length)}
                    </p>
                    <ul className="mt-[1cqh] flex flex-wrap justify-center gap-x-[4cqw] gap-y-[1cqh]">
                      {place.entries.map((e) => (
                        <li key={e.video.id}>
                          <p className={`${place.rank === 1 ? 'text-[5cqh]' : 'text-[3.6cqh]'} font-bold leading-tight`}>{e.video.title}</p>
                          <p className="mt-[0.6cqh] flex items-center justify-center gap-2 text-[2.6cqh] text-parchment-dim">
                            <Avatar user={e.video.author} size={30} /> {e.video.author.displayName}
                            <span className="text-mist">({plural(e.votes, 'vote')})</span>
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {slide.kind === 'video' && cat && (
          <div className="w-full">
            <p className="font-display text-[2.4cqh] text-gold">
              {cat.category.name}: {slide.winners.length > 1 ? 'joint winners' : 'winner'}
            </p>
            <div className={`mx-auto mt-[2cqh] grid gap-[3cqh] ${slide.winners.length > 1 ? 'max-w-[90cqw] grid-cols-2' : 'max-w-[62cqw]'}`}>
              {slide.winners.map((w) => (
                <div key={`${w.video.id}-${playKey}`} className="reveal-in">
                  <VideoPlayer video={w.video} startLoaded={playKey > 0} autoplay={playKey > 0} />
                  <p className="mt-[1.5cqh] text-[3.4cqh] font-bold">{w.video.title}</p>
                  <p className="flex items-center justify-center gap-2 text-[2.4cqh] text-parchment-dim">
                    <Avatar user={w.video.author} size={28} /> {w.video.author.displayName}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {slide.kind === 'finale' && (
          <div className="w-full reveal-in">
            <Pennants className="mx-auto h-[9cqh] w-[18cqh]" />
            <h1 className="mt-[2cqh] text-[6cqh]">Congratulations to the winners</h1>
            <ul className="mx-auto mt-[4cqh] grid max-w-[85cqw] grid-cols-2 gap-x-[4cqw] gap-y-[2cqh] text-left">
              {results.categories.map((c) => (
                <li key={c.category.id} className="border-l-2 border-gold pl-[1.5cqh]">
                  <p className="font-display text-[2.2cqh] text-gold">{c.category.name}</p>
                  <p className="truncate text-[2.6cqh]">
                    {c.winners.length ? c.winners.map((w) => w.video.author.displayName).join(' & ') : 'No votes cast'}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="relative flex items-center justify-between px-[3cqw] pb-[2cqh] text-[1.8cqh] text-mist">
        <span className="flex items-center gap-2 font-display">
          Eden Awards
        </span>
        <span>{results.season.name}</span>
      </div>
    </div>
    </div>
  );
}

function Thumb({ entry }: { entry: RankedEntry }) {
  const v = entry.video;
  const src = v.thumbnailUrl ?? (v.platform === 'youtube' ? `https://i.ytimg.com/vi/${v.platformVideoId}/hqdefault.jpg` : null);
  return src ? (
    <img src={src} alt="" className="aspect-video w-full rounded object-cover" referrerPolicy="no-referrer" />
  ) : (
    <div className="flex aspect-video w-full items-center justify-center rounded bg-night text-[2cqh] text-mist">Twitch</div>
  );
}
