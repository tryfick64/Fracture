import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";

import {
  type GameCard,
  buildDeck,
  FACTION_COLORS,
  TYPE_COLORS,
} from "./cardData";

import { useRoom, generateRoomKey } from "./lib/realtime.ts";

const CARD_W = 140;
const CARD_H = 190;
const STACK_THRESHOLD = 40;
const TOKEN_BASE_Z = 10000;

const DECK_X = 20;
const DECK_Y = 20;

const DISCARD_X = window.innerWidth - 180;
const DISCARD_Y = window.innerHeight - 300;

const TOKEN_SPAWN_X = 20;
const TOKEN_SPAWN_Y = 240;
const INFECTION_SPAWN_X = 75;
const INFECTION_SPAWN_Y = 240;

interface DamageToken {
  id: number;
  x: number;
  y: number;
  zIndex: number;
  type: "damage" | "infection";
}

interface GameState {
  cards: GameCard[];
  tokens: DamageToken[];
  maxZ: number;
  turnCount: number;
  nextTokenId: number;
}

interface SaveState extends GameState {}

function getInitialCards(): GameCard[] {
  const deck = buildDeck();
  return deck.map((c, i) => ({
    ...c,
    x: DECK_X,
    y: DECK_Y,
    zIndex: i,
    faceDown: true,
    stackedUnder: null,
    stackCount: 0,
  }));
}

function loadLocalSave(): SaveState | null {
  try {
    const raw = localStorage.getItem("fracture-save");
    if (!raw) return null;
    return JSON.parse(raw) as SaveState;
  } catch {
    return null;
  }
}

// ── Экран лобби ──────────────────────────────────────────────────────────────
function Lobby({
  onCreate,
  onJoin,
  onSolo,
}: {
  onCreate: () => void;
  onJoin: (key: string) => void;
  onSolo: () => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tryJoin = () => {
    const k = keyInput.trim().toUpperCase();
    if (k.length < 4) {
      setError("Введите ключ комнаты (минимум 4 символа)");
      return;
    }
    setError(null);
    onJoin(k);
  };

  return (
    <div className="lobby">
      <div className="lobby__card">
        <h1 className="fracture-title lobby__title">FRACTURE</h1>
        <p className="lobby__subtitle">Онлайн-партия для двух игроков</p>

        <button className="btn btn--primary lobby__btn" onClick={onCreate}>
          🆕 Создать комнату
        </button>

        <div className="lobby__divider">
          <span>или</span>
        </div>

        <div className="lobby__join">
          <input
            className="lobby__input"
            type="text"
            placeholder="КЛЮЧ КОМНАТЫ"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && tryJoin()}
            maxLength={12}
            autoFocus
          />
          <button className="btn lobby__btn" onClick={tryJoin}>
            Войти по ключу
          </button>
        </div>

        {error && <div className="lobby__error">{error}</div>}

        <button className="btn btn--muted lobby__btn lobby__btn--solo" onClick={onSolo}>
          Играть локально (без сети)
        </button>
      </div>
    </div>
  );
}

// ── Главный компонент ────────────────────────────────────────────────────────
export default function App() {
  // null = лобби, "SOLO" = локальная игра без сети, иначе — ключ комнаты
  const [roomKey, setRoomKey] = useState<string | null>(null);
  const [showCopied, setShowCopied] = useState(false);

  const initialSave = useMemo(() => loadLocalSave(), []);

  const [cards, setCards] = useState<GameCard[]>(
    () => initialSave?.cards ?? getInitialCards()
  );
  const [maxZ, setMaxZ] = useState(() => initialSave?.maxZ ?? 100);
  const [turnCount, setTurnCount] = useState(() => initialSave?.turnCount ?? 0);
  const [tokens, setTokens] = useState<DamageToken[]>(
    () => initialSave?.tokens ?? []
  );
  const [nextTokenId, setNextTokenId] = useState(
    () => initialSave?.nextTokenId ?? 0
  );

  // Текущее «слепленное» состояние для отправки в комнату
  const liveState: GameState = useMemo(
    () => ({ cards, tokens, maxZ, turnCount, nextTokenId }),
    [cards, tokens, maxZ, turnCount, nextTokenId]
  );

  // Применить состояние, пришедшее от другого игрока
  const applyRemote = useCallback((s: GameState) => {
    setCards(s.cards);
    setTokens(s.tokens);
    setMaxZ(s.maxZ);
    setTurnCount(s.turnCount);
    setNextTokenId(s.nextTokenId);
  }, []);

  const inOnlineRoom = roomKey !== null && roomKey !== "SOLO";

  const { connected, peerCount } = useRoom<GameState>({
    roomKey: inOnlineRoom ? roomKey : null,
    state: liveState,
    applyRemoteState: applyRemote,
    throttleMs: 40,
  });

  // Автосохранение в localStorage только для SOLO-режима
  useEffect(() => {
    if (roomKey !== "SOLO") return;
    try {
      const state: SaveState = { cards, tokens, maxZ, turnCount, nextTokenId };
      localStorage.setItem("fracture-save", JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save:", e);
    }
  }, [cards, tokens, maxZ, turnCount, nextTokenId, roomKey]);

  // ── Действия лобби ────────────────────────────────────────────────────────
  const handleCreateRoom = useCallback(() => {
    const key = generateRoomKey(6);
    // Создатель стартует со свежей игрой
    setCards(getInitialCards());
    setTokens([]);
    setMaxZ(100);
    setTurnCount(0);
    setNextTokenId(0);
    setRoomKey(key);
  }, []);

  const handleJoinRoom = useCallback((key: string) => {
    // При входе ждём, пока хозяин пришлёт состояние через sync-request.
    setRoomKey(key);
  }, []);

  const handleSolo = useCallback(() => {
    setRoomKey("SOLO");
  }, []);

  const handleLeaveRoom = useCallback(() => {
    setRoomKey(null);
  }, []);

  const copyKey = useCallback(() => {
    if (!inOnlineRoom || !roomKey) return;
    void navigator.clipboard.writeText(roomKey).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 1500);
    });
  }, [inOnlineRoom, roomKey]);

  // ── Рефы для drag ─────────────────────────────────────────────────────────
  const dragging = useRef<{
    type: "card" | "token";
    id: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);

  // ── Раздать базар ─────────────────────────────────────────────────────────
  const dealBazaar = useCallback(() => {
    setCards((prev) => {
      let current = [...prev];

      const inDeck = current.filter(
        (c) =>
          c.x === DECK_X &&
          c.y === DECK_Y &&
          c.faceDown &&
          c.stackedUnder === null
      );

      if (inDeck.length === 0) {
        const discardCards = current.filter(
          (c) =>
            c.x === DISCARD_X + 10 &&
            c.y === DISCARD_Y + 15 &&
            c.stackedUnder === null
        );

        if (discardCards.length === 0) return current;

        const discardIds = new Set(discardCards.map((c) => c.id));

        current = current.map((c) => {
          if (discardIds.has(c.id)) {
            return {
              ...c,
              x: DECK_X,
              y: DECK_Y,
              faceDown: true,
              stackedUnder: null,
              stackCount: 0,
              zIndex: Math.floor(Math.random() * 50),
            };
          }
          return c;
        });
      }

      const undealt = current.filter(
        (c) =>
          c.x === DECK_X &&
          c.y === DECK_Y &&
          c.faceDown &&
          c.stackedUnder === null
      );
      const toDeal = undealt.slice(0, 6);
      if (toDeal.length === 0) return current;

      const bazaarX = 200;
      const bazaarY = 20;
      const gapX = CARD_W + 10;
      const gapY = CARD_H + 10;
      const cols = 3;

      return current.map((c) => {
        const idx = toDeal.findIndex((d) => d.id === c.id);
        if (idx === -1) return c;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        return {
          ...c,
          x: bazaarX + col * gapX,
          y: bazaarY + row * gapY,
          faceDown: false,
          zIndex: maxZ + idx + 1,
        };
      });
    });
    setMaxZ((z) => z + 10);
    setTurnCount((t) => t + 1);
  }, [maxZ]);

  // ── Новая игра ────────────────────────────────────────────────────────────
  const restart = useCallback(() => {
    if (roomKey === "SOLO") localStorage.removeItem("fracture-save");
    setCards(getInitialCards());
    setMaxZ(100);
    setTokens([]);
    setNextTokenId(0);
    setTurnCount(0);
  }, [roomKey]);

  // ── Сброс в колоду ────────────────────────────────────────────────────────
  const shuffleDiscardToDeck = useCallback(() => {
    setCards((prev) => {
      const discardCards = prev.filter(
        (c) =>
          c.x >= DISCARD_X - 20 &&
          c.x <= DISCARD_X + 160 &&
          c.y >= DISCARD_Y - 20 &&
          c.y <= DISCARD_Y + 210 &&
          c.stackedUnder === null
      );
      if (discardCards.length === 0) return prev;

      const discardIds = new Set(discardCards.map((c) => c.id));

      return prev.map((c) => {
        if (discardIds.has(c.id)) {
          return {
            ...c,
            x: DECK_X,
            y: DECK_Y,
            faceDown: true,
            stackedUnder: null,
            stackCount: 0,
            zIndex: Math.floor(Math.random() * 50),
          };
        }
        return c;
      });
    });
  }, []);

  // ── Перевернуть карту ─────────────────────────────────────────────────────
  const handleCardDoubleClick = useCallback((id: number) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, faceDown: !c.faceDown } : c))
    );
  }, []);

  // ── Создать токен урона ───────────────────────────────────────────────────
  const spawnToken = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const newZ = TOKEN_BASE_Z + nextTokenId;
      const token: DamageToken = {
        id: nextTokenId,
        x: TOKEN_SPAWN_X,
        y: TOKEN_SPAWN_Y,
        zIndex: newZ,
        type: "damage",
      };
      setTokens((prev) => [...prev, token]);
      setNextTokenId((id) => id + 1);
      dragging.current = {
        type: "token",
        id: token.id,
        offsetX: e.clientX - TOKEN_SPAWN_X,
        offsetY: e.clientY - TOKEN_SPAWN_Y,
      };
    },
    [nextTokenId]
  );

  // ── Создать токен инфекции ────────────────────────────────────────────────
  const spawnInfectionToken = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const newZ = TOKEN_BASE_Z + nextTokenId;
      const token: DamageToken = {
        id: nextTokenId,
        x: INFECTION_SPAWN_X,
        y: INFECTION_SPAWN_Y,
        zIndex: newZ,
        type: "infection",
      };
      setTokens((prev) => [...prev, token]);
      setNextTokenId((id) => id + 1);
      dragging.current = {
        type: "token",
        id: token.id,
        offsetX: e.clientX - INFECTION_SPAWN_X,
        offsetY: e.clientY - INFECTION_SPAWN_Y,
      };
    },
    [nextTokenId]
  );

  // ── Начало перетаскивания карты ───────────────────────────────────────────
  const handleCardMouseDown = useCallback(
    (e: React.MouseEvent, id: number) => {
      e.preventDefault();
      e.stopPropagation();

      const card = cards.find((c) => c.id === id);
      if (!card) return;

      // Карта под другим каркасом — отсоединяем
      if (card.stackedUnder !== null) {
        setCards((prev) =>
          prev.map((c) => {
            if (c.id === id) return { ...c, stackedUnder: null };
            if (c.id === card.stackedUnder)
              return { ...c, stackCount: Math.max(0, c.stackCount - 1) };
            return c;
          })
        );
        const newZ = maxZ + 1;
        setMaxZ(newZ);
        setCards((prev) =>
          prev.map((c) => (c.id === id ? { ...c, zIndex: newZ } : c))
        );
        dragging.current = {
          type: "card",
          id,
          offsetX: e.clientX - card.x,
          offsetY: e.clientY - card.y,
        };
        return;
      }

      // Каркас T2/T3 — вытащить последний слой
      if (card.faceDown && card.stackCount > 0) {
        const children = cards.filter(
          (c) => c.stackedUnder === id && c.faceDown
        );
        const lastChild = children.reduce(
          (best, c) => (c.id > best.id ? c : best),
          children[0]
        );
        if (lastChild) {
          const newZ = maxZ + 1;
          setMaxZ(newZ);
          setCards((prev) =>
            prev.map((c) => {
              if (c.id === lastChild.id) {
                return {
                  ...c,
                  stackedUnder: null,
                  x: e.clientX - CARD_W / 2,
                  y: e.clientY - CARD_H / 2,
                  zIndex: newZ,
                };
              }
              if (c.id === id) {
                return { ...c, stackCount: Math.max(0, c.stackCount - 1) };
              }
              return c;
            })
          );
          dragging.current = {
            type: "card",
            id: lastChild.id,
            offsetX: CARD_W / 2,
            offsetY: CARD_H / 2,
          };
          return;
        }
      }

      // Обычное перетаскивание
      const newZ = maxZ + 1;
      setMaxZ(newZ);
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, zIndex: newZ } : c))
      );
      dragging.current = {
        type: "card",
        id,
        offsetX: e.clientX - card.x,
        offsetY: e.clientY - card.y,
      };
    },
    [cards, maxZ]
  );

  // ── Начало перетаскивания токена ──────────────────────────────────────────
  const handleTokenMouseDown = useCallback(
    (e: React.MouseEvent, id: number) => {
      e.preventDefault();
      e.stopPropagation();
      const token = tokens.find((t) => t.id === id);
      if (!token) return;
      const newZ = TOKEN_BASE_Z + nextTokenId + 1;
      setTokens((prev) =>
        prev.map((t) => (t.id === id ? { ...t, zIndex: newZ } : t))
      );
      dragging.current = {
        type: "token",
        id,
        offsetX: e.clientX - token.x,
        offsetY: e.clientY - token.y,
      };
    },
    [tokens, nextTokenId]
  );

  // ── Перемещение ───────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    const { type, id, offsetX, offsetY } = dragging.current;
    const nx = e.clientX - offsetX;
    const ny = e.clientY - offsetY;
    if (type === "card") {
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, x: nx, y: ny } : c))
      );
    } else {
      setTokens((prev) =>
        prev.map((t) => (t.id === id ? { ...t, x: nx, y: ny } : t))
      );
    }
  }, []);

  // ── Отпускание ────────────────────────────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    if (!dragging.current) return;
    const { type, id } = dragging.current;
    dragging.current = null;

    if (type === "card") {
      setCards((prev) => {
        const dragCard = prev.find((c) => c.id === id);
        if (!dragCard) return prev;

        const inDiscard =
          dragCard.x >= DISCARD_X - 40 &&
          dragCard.x <= DISCARD_X + 180 &&
          dragCard.y >= DISCARD_Y - 40 &&
          dragCard.y <= DISCARD_Y + 230;

        if (inDiscard) {
          return prev.map((c) => {
            if (c.id === id || c.stackedUnder === id) {
              return {
                ...c,
                x: DISCARD_X + 10,
                y: DISCARD_Y + 15,
                faceDown: true,
                stackedUnder: null,
                stackCount: 0,
                zIndex: 2,
              };
            }
            return c;
          });
        }

        let bestTarget: GameCard | null = null;
        let bestDist = STACK_THRESHOLD;

        prev.forEach((c) => {
          if (c.id === id) return;
          if (c.stackedUnder !== null) return;
          const dx = Math.abs(dragCard.x - c.x);
          const dy = Math.abs(dragCard.y - c.y);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestDist) {
            if (dragCard.faceDown && c.faceDown) {
              bestDist = dist;
              bestTarget = c;
            } else if (!dragCard.faceDown && c.faceDown) {
              bestDist = dist;
              bestTarget = c;
            }
          }
        });

        if (bestTarget) {
          const target = bestTarget as GameCard;
          if (dragCard.faceDown && target.faceDown) {
            return prev.map((c) => {
              if (c.id === id) {
                return {
                  ...c,
                  x: target.x,
                  y: target.y,
                  stackedUnder: target.id,
                  zIndex: target.zIndex - 1,
                };
              }
              if (c.id === target.id) {
                return { ...c, stackCount: c.stackCount + 1 };
              }
              return c;
            });
          }
        }
        return prev;
      });
    }
  }, []);

  // ── Удалить токен правым кликом ───────────────────────────────────────────
  const handleTokenRightClick = useCallback(
    (e: React.MouseEvent, id: number) => {
      e.preventDefault();
      e.stopPropagation();
      setTokens((prev) => prev.filter((t) => t.id !== id));
    },
    []
  );

  // ── Глобальные обработчики мыши ───────────────────────────────────────────
  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // ── Подсчёты ──────────────────────────────────────────────────────────────
  const remaining = cards.filter(
    (c) =>
      c.x === DECK_X &&
      c.y === DECK_Y &&
      c.faceDown &&
      c.stackedUnder === null
  ).length;

  const discardCount = cards.filter(
    (c) =>
      c.x === DISCARD_X + 10 &&
      c.y === DISCARD_Y + 15 &&
      c.stackedUnder === null
  ).length;

  const visibleCards = [...cards].sort((a, b) => a.zIndex - b.zIndex);

  // ── Экран лобби ───────────────────────────────────────────────────────────
  if (roomKey === null) {
    return (
      <Lobby
        onCreate={handleCreateRoom}
        onJoin={handleJoinRoom}
        onSolo={handleSolo}
      />
    );
  }

  // ── Игровое поле ──────────────────────────────────────────────────────────
  return (
    <div className="fracture-app">
      <div className="controls">
        <h1 className="fracture-title">FRACTURE</h1>
        <button className="btn" onClick={dealBazaar}>
          Раздать Базар (6 карт)
        </button>
        <button className="btn btn--muted" onClick={restart}>
          Новая игра
        </button>
        <span className="deck-counter">Колода: {remaining}</span>
        <span className="deck-counter">Ход: {turnCount}</span>

        {inOnlineRoom && (
          <>
            <span
              className={`room-badge ${connected ? "room-badge--ok" : "room-badge--wait"}`}
              onClick={copyKey}
              title="Скопировать ключ"
            >
              🔑 {roomKey}{" "}
              <small>
                {connected ? `(игроков: ${peerCount})` : "подключение…"}
              </small>
              {showCopied && <em className="room-badge__copied">скопировано!</em>}
            </span>
            <button className="btn btn--muted" onClick={handleLeaveRoom}>
              Выйти из комнаты
            </button>
          </>
        )}
        {roomKey === "SOLO" && (
          <button className="btn btn--muted" onClick={handleLeaveRoom}>
            ← В лобби
          </button>
        )}
      </div>

      <div className="board" ref={boardRef}>
        <div className="board__lines">
          <div className="board__line board__line--p2back">
            <span className="line-label">Бэк (P2)</span>
          </div>
          <div className="board__line board__line--p2mid">
            <span className="line-label">Мид (P2)</span>
          </div>
          <div className="board__line board__line--p2front">
            <span className="line-label">Фронт (P2)</span>
          </div>
          <div className="board__line board__line--p1front">
            <span className="line-label">Фронт (P1)</span>
          </div>
          <div className="board__line board__line--p1mid">
            <span className="line-label">Мид (P1)</span>
          </div>
          <div className="board__line board__line--p1back">
            <span className="line-label">Бэк (P1)</span>
          </div>
        </div>

        <div className="deck-zone" style={{ left: DECK_X, top: DECK_Y }}>
          <span className="deck-zone__label">КОЛОДА ({remaining})</span>
        </div>

        <div
          className="token-spawner"
          style={{ left: TOKEN_SPAWN_X, top: TOKEN_SPAWN_Y }}
          onMouseDown={spawnToken}
        >
          <div className="token-hex token-hex--spawner token-hex--damage">
            <span className="token-hex__text">DMG</span>
          </div>
        </div>

        <div
          className="token-spawner"
          style={{ left: INFECTION_SPAWN_X, top: INFECTION_SPAWN_Y }}
          onMouseDown={spawnInfectionToken}
        >
          <div className="token-hex token-hex--spawner token-hex--infection">
            <span className="token-hex__text">INF</span>
          </div>
        </div>

        {/* Карты */}
        {visibleCards.map((card) => (
          <div
            key={card.id}
            className={`card ${card.faceDown ? "card--facedown" : ""}`}
            style={{
              left: card.x,
              top: card.y,
              zIndex: card.zIndex,
              borderColor: card.faceDown
                ? undefined
                : FACTION_COLORS[card.faction] || "#555",
            }}
            onMouseDown={(e) => handleCardMouseDown(e, card.id)}
            onDoubleClick={() => handleCardDoubleClick(card.id)}
          >
            {card.faceDown ? (
              <div className="card__back">
                <span className="card__back-text">КАРКАС</span>
                {card.stackCount > 0 && (
                  <span className="card__stack-badge">
                    T{card.stackCount + 1}
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="card__header">
                  <span className="card__tier">
                    {card.tier ? `T${card.tier}` : "—"}
                  </span>
                  <span
                    className="card__type"
                    style={{ background: TYPE_COLORS[card.type] || "#555" }}
                  >
                    {card.type}
                  </span>
                </div>
                <div className="card__name">{card.name}</div>
                <div className="card__stat">{card.stat}</div>
                <div className="card__desc">{card.desc}</div>
                <div
                  className="card__faction"
                  style={{ color: FACTION_COLORS[card.faction] || "#555" }}
                >
                  {card.faction}
                </div>
              </>
            )}
          </div>
        ))}

        {/* Токены */}
        {tokens.map((token) => (
          <div
            key={`token-${token.id}`}
            className={`token-hex ${
              token.type === "infection"
                ? "token-hex--infection"
                : "token-hex--damage"
            }`}
            style={{
              left: token.x,
              top: token.y,
              zIndex: token.zIndex,
            }}
            onMouseDown={(e) => handleTokenMouseDown(e, token.id)}
            onContextMenu={(e) => handleTokenRightClick(e, token.id)}
          >
            <span className="token-hex__text">
              {token.type === "infection" ? "I" : "1"}
            </span>
          </div>
        ))}

        {/* Зона сброса */}
        <div
          className="discard-zone"
          style={{ left: DISCARD_X, top: DISCARD_Y }}
        >
          <span className="discard-zone__label">СБРОС ({discardCount})</span>
          <button
            className="btn btn--small"
            onClick={shuffleDiscardToDeck}
            onMouseDown={(e) => e.stopPropagation()}
          >
            В колоду
          </button>
        </div>
      </div>
    </div>
  );
}
