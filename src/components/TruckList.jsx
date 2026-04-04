import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { MAX_NAME_LENGTH, MAX_FOOD_LENGTH } from "../constants";
import { getFoodEmoji, formatSchedule, timeAgo, containsProfanity, logEvent } from "../utils";

/* ─── Bottom Sheet Hook ────────────────────────────────────────────────────── */
const SNAP_POINTS = { peek: 110, half: () => window.innerHeight * 0.45, full: () => window.innerHeight * 0.85 };
function getSnapHeight(name) { const v = SNAP_POINTS[name]; return typeof v === "function" ? v() : v; }

function useBottomSheet() {
  const [snap, setSnap] = useState("peek");
  const sheetRef = useRef(null);
  const contentRef = useRef(null);
  const dragRef = useRef({ startY: 0, startHeight: 0, dragging: false, fromContent: false });

  const applyTranslate = useCallback((h) => {
    const el = sheetRef.current;
    if (!el) return;
    const full = getSnapHeight("full");
    el.style.transform = `translateY(${full - h}px)`;
  }, []);

  const onDragStart = useCallback((e) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = "none";
    dragRef.current = { startY: y, startHeight: getSnapHeight(snap), dragging: false, fromContent: false };
  }, [snap]);

  const onContentDragStart = useCallback((e) => {
    const scrollEl = contentRef.current;
    if (!scrollEl || scrollEl.scrollTop > 0) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = "none";
    dragRef.current = { startY: y, startHeight: getSnapHeight(snap), dragging: false, fromContent: true };
  }, [snap]);

  const onDragMove = useCallback((e) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const d = dragRef.current;
    if (!d.startY) return;
    const delta = d.startY - y;
    // Content drags only work downward (closing)
    if (d.fromContent && delta > 0) { d.startY = 0; return; }
    if (!d.dragging && Math.abs(delta) > 5) d.dragging = true;
    if (!d.dragging) return;
    if (d.fromContent) e.preventDefault();
    const h = Math.max(getSnapHeight("peek"), Math.min(getSnapHeight("full"), d.startHeight + delta));
    applyTranslate(h);
  }, [applyTranslate]);

  const onDragEnd = useCallback((e) => {
    const el = sheetRef.current;
    if (el) el.style.transition = "";
    const d = dragRef.current;
    if (!d.startY && d.fromContent) return;
    const y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    if (!d.dragging) {
      if (!d.fromContent) setSnap(s => s === "peek" ? "half" : s === "half" ? "full" : "half");
      return;
    }
    const delta = d.startY - y;
    const currentH = Math.max(getSnapHeight("peek"), Math.min(getSnapHeight("full"), d.startHeight + delta));
    const snapNames = ["peek", "half", "full"];
    let closest = "peek", closestDist = Infinity;
    for (const s of snapNames) {
      const dist = Math.abs(currentH - getSnapHeight(s));
      if (dist < closestDist) { closestDist = dist; closest = s; }
    }
    setSnap(closest);
  }, []);

  useLayoutEffect(() => {
    applyTranslate(getSnapHeight(snap));
  }, [snap, applyTranslate]);

  useEffect(() => {
    const onResize = () => applyTranslate(getSnapHeight(snap));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [snap, applyTranslate]);

  return { snap, setSnap, sheetRef, contentRef, onDragStart, onContentDragStart, onDragMove, onDragEnd };
}

export function PopupTopComment({ truckId }) {
  const [topComment, setTopComment] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("comments")
      .select("body, votes")
      .eq("truck_id", truckId)
      .order("votes", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data?.length) setTopComment(data[0]);
      });
    return () => { cancelled = true; };
  }, [truckId]);

  if (!topComment) return null;
  return (
    <div className="popup-top-comment">
      "{topComment.body}" &nbsp;👍 {topComment.votes}
    </div>
  );
}

/* ─── Truck Comments ────────────────────────────────────────────────────────── */
export function TruckComments({ truckId, userId, isAdmin, onAdminHideComment, onAdminDeleteComment }) {
  const [comments, setComments] = useState([]);
  const [commentVotes, setCommentVotes] = useState({});
  const [loadState, setLoadState] = useState("loading");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [sortBy, setSortBy] = useState("top");
  const votingRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("comments").select("id, body, created_at, user_id, votes").eq("truck_id", truckId).limit(50),
      userId ? supabase.from("comment_votes").select("comment_id, vote").eq("user_id", userId) : { data: [] },
    ]).then(([commentsRes, votesRes]) => {
      if (cancelled) return;
      if (commentsRes.error) { setLoadState("error"); return; }
      setComments(commentsRes.data);
      const voteMap = {};
      (votesRes.data || []).forEach(v => { voteMap[v.comment_id] = v.vote; });
      setCommentVotes(voteMap);
      setLoadState("done");
    });
    return () => { cancelled = true; };
  }, [truckId, userId]);

  // Realtime: update comments when others post, edit, or delete
  useEffect(() => {
    const channel = supabase.channel(`comments-${truckId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter: `truck_id=eq.${truckId}` }, payload => {
        setComments(cur => cur.find(c => c.id === payload.new.id) ? cur : [...cur, payload.new]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "comments", filter: `truck_id=eq.${truckId}` }, payload => {
        setComments(cur => cur.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "comments", filter: `truck_id=eq.${truckId}` }, payload => {
        setComments(cur => cur.filter(c => c.id !== payload.old.id));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [truckId]);

  const userAlreadyCommented = comments.some(c => c.user_id === userId);

  async function handlePost() {
    const body = draft.trim();
    if (!body || !userId || posting || userAlreadyCommented) return;
    if (containsProfanity(body)) { alert("Please keep comments clean."); return; }
    setPosting(true);
    const { data, error } = await supabase
      .from("comments")
      .insert({ truck_id: truckId, user_id: userId, body })
      .select()
      .single();
    if (error) alert("Couldn't post comment — try again.");
    else { setComments(cur => cur.find(c => c.id === data.id) ? cur : [{ ...data, votes: 0 }, ...cur]); setDraft(""); }
    setPosting(false);
  }

  async function handleCommentVote(commentId, vote) {
    const existing = commentVotes[commentId];
    if (existing === vote) return;
    if (votingRef.current.has(commentId)) return;
    votingRef.current.add(commentId);

    let delta = vote;
    if (existing) {
      const { error } = await supabase.from("comment_votes").delete().eq("comment_id", commentId).eq("user_id", userId);
      if (error) { votingRef.current.delete(commentId); alert("Vote failed — try again."); return; }
      delta = vote - existing;
    }

    const { error } = await supabase.from("comment_votes").insert({ comment_id: commentId, user_id: userId, vote });
    votingRef.current.delete(commentId);
    if (error) { alert("Vote failed — try again."); return; }
    const newVotes = (comments.find(c => c.id === commentId)?.votes || 0) + delta;
    await supabase.from("comments").update({ votes: newVotes }).eq("id", commentId);
    setCommentVotes(v => ({ ...v, [commentId]: vote }));
    setComments(cur => cur.map(c => c.id === commentId ? { ...c, votes: c.votes + delta } : c));
  }

  async function handleDelete(commentId) {
    const { error } = await supabase.from("comments").delete().eq("id", commentId).eq("user_id", userId);
    if (error) alert("Couldn't delete comment — try again.");
    else setComments(cur => cur.filter(c => c.id !== commentId));
  }

  const sorted = useMemo(() => {
    const copy = [...comments];
    if (sortBy === "top") copy.sort((a, b) => b.votes - a.votes);
    else copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return copy;
  }, [comments, sortBy]);

  const nearLimit = draft.length > 240;

  return (
    <div className="truck-comments">
      {loadState === "loading" && <div className="comments-empty">Loading…</div>}
      {loadState === "error"   && <div className="comments-empty">Couldn't load comments.</div>}
      {loadState === "done" && (
        <>
          {comments.length > 1 && (
            <div className="comment-sort-row">
              <button className={`comment-sort-btn ${sortBy === "top" ? "active" : ""}`} onClick={() => setSortBy("top")}>Top</button>
              <button className={`comment-sort-btn ${sortBy === "new" ? "active" : ""}`} onClick={() => setSortBy("new")}>New</button>
            </div>
          )}
          {comments.length === 0
            ? <div className="comments-empty">No comments yet. Be the first!</div>
            : (
              <div className="comments-list">
                {sorted.map(c => (
                  <div className="comment-row" key={c.id}>
                    <div style={{ flex: 1 }}>
                      <div className="comment-body">{c.body}</div>
                      <div className="comment-vote-row">
                        <button className={`comment-vote-btn ${commentVotes[c.id] === 1 ? "voted-up" : ""}`} onClick={() => handleCommentVote(c.id, 1)} disabled={commentVotes[c.id] === 1} aria-label="Upvote comment">▲</button>
                        <span className="comment-vote-count">{c.votes}</span>
                        <button className={`comment-vote-btn ${commentVotes[c.id] === -1 ? "voted-down" : ""}`} onClick={() => handleCommentVote(c.id, -1)} disabled={commentVotes[c.id] === -1} aria-label="Downvote comment">▼</button>
                        <span className="comment-meta" style={{ marginLeft: 6 }}>{timeAgo(c.created_at)}</span>
                      </div>
                    </div>
                    {c.user_id === userId && (
                      <button className="comment-del" onClick={() => handleDelete(c.id)} title="Delete" aria-label="Delete comment">✕</button>
                    )}
                    {isAdmin && c.user_id !== userId && (
                      <div className="admin-comment-actions">
                        <button className="comment-del" onClick={async () => { const ok = await onAdminHideComment(c.id); if (ok) setComments(cur => cur.filter(x => x.id !== c.id)); }} title="Hide" aria-label="Hide comment">🚫</button>
                        <button className="comment-del" onClick={async () => { const ok = await onAdminDeleteComment(c.id); if (ok) setComments(cur => cur.filter(x => x.id !== c.id)); }} title="Delete" aria-label="Delete comment">🗑</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          }
          {userAlreadyCommented
            ? <div className="comments-empty">You've already commented on this truck.</div>
            : (
              <div className="comment-input-row">
                <textarea
                  className="comment-textarea"
                  placeholder={userId ? "Add a comment…" : "Connecting…"}
                  value={draft}
                  maxLength={280}
                  disabled={!userId}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                />
                <span className={`comment-char ${nearLimit ? "near-limit" : ""}`}>{draft.length}/280</span>
                <button className="btn-post-comment" onClick={handlePost} disabled={posting || !draft.trim() || !userId}>
                  {posting ? "…" : "Post"}
                </button>
              </div>
            )
          }
        </>
      )}
    </div>
  );
}

export function TruckList({ visibleTrucks, userVotes, onVote, onConfirmStillHere, onReportClosed, myTruckIds, onDeleteTruck, onEditTruck, onFocusTruck, userId, onShareTruck, favorites, onToggleFavorite, isAdmin, onAdminHideComment, onAdminDeleteComment, onFindNearest }) {
  const [showOpenOnly, setShowOpenOnly] = useState(true);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [foodFilter, setFoodFilter] = useState("");
  const [sortBy, setSortBy] = useState("distance");
  const [searchText, setSearchText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [openCommentsId, setOpenCommentsId] = useState(null);
  const [openVoteId, setOpenVoteId] = useState(null);
  const [openStatusId, setOpenStatusId] = useState(null);
  const [commentCounts, setCommentCounts] = useState({});

  const prevTruckIdsRef = useRef("");

  function fetchCommentCounts(ids) {
    supabase.from("comments").select("truck_id").in("truck_id", ids)
      .then(({ data }) => {
        if (!data) return;
        const counts = {};
        data.forEach(c => { counts[c.truck_id] = (counts[c.truck_id] || 0) + 1; });
        setCommentCounts(counts);
      });
  }

  useEffect(() => {
    const ids = visibleTrucks.map(t => t.id);
    const key = ids.slice().sort().join(",");
    if (key === prevTruckIdsRef.current || ids.length === 0) return;
    const timer = setTimeout(() => {
      prevTruckIdsRef.current = key;
      fetchCommentCounts(ids);
    }, 300);
    return () => clearTimeout(timer);
  }, [visibleTrucks]);

  // Realtime: refresh comment counts when comments are added or removed
  useEffect(() => {
    const channel = supabase.channel("comments-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => {
        const ids = visibleTrucks.map(t => t.id);
        if (ids.length > 0) fetchCommentCounts(ids);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [visibleTrucks]);

  useEffect(() => {
    if (!openVoteId && !openStatusId) return;
    function handleClick() { setOpenVoteId(null); setOpenStatusId(null); }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openVoteId, openStatusId]);

  const [editName, setEditName] = useState("");
  const [editFood, setEditFood] = useState("");
  const [editOpen, setEditOpen] = useState(true);

  // Close edit form if the truck being edited is removed
  useEffect(() => {
    if (editingId && !visibleTrucks.some(t => t.id === editingId)) {
      setEditingId(null);
    }
  }, [visibleTrucks, editingId]);

  function startEdit(truck) {
    setEditingId(truck.id);
    setEditName(truck.name);
    setEditFood(truck.foodType);
    setEditOpen(truck.open);
  }

  function saveEdit() {
    const name = editName.trim(), foodType = editFood.trim();
    if (!name || !foodType) return;
    if (containsProfanity(name) || containsProfanity(foodType)) { alert("Please keep truck names and food types clean."); return; }
    onEditTruck(editingId, { name, foodType, open: editOpen });
    setEditingId(null);
  }

  const foodTypes = useMemo(() =>
    [...new Set(visibleTrucks.map(t => t.foodType).filter(Boolean))].sort(),
    [visibleTrucks]
  );

  const activeFoodFilter = foodTypes.includes(foodFilter) ? foodFilter : "";

  const displayed = useMemo(() => {
    let list = visibleTrucks;
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.foodType.toLowerCase().includes(q) || (t.street && t.street.toLowerCase().includes(q)));
    }
    if (showFavoritesOnly) list = list.filter(t => favorites.includes(t.id));
    if (showOpenOnly) list = list.filter(t => t.open);
    if (activeFoodFilter) list = list.filter(t => t.foodType === activeFoodFilter);
    if (sortBy === "votes") list = [...list].sort((a, b) => b.votes - a.votes);
    return list;
  }, [visibleTrucks, searchText, showOpenOnly, showFavoritesOnly, favorites, activeFoodFilter, sortBy]);

  const { snap, setSnap, sheetRef, contentRef, onDragStart, onContentDragStart, onDragMove, onDragEnd } = useBottomSheet();

  return (
    <div className={`bottom-sheet snap-${snap}`} ref={sheetRef}>
      <div className="sheet-handle" onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd} onMouseDown={onDragStart} onMouseMove={onDragMove} onMouseUp={onDragEnd}>
        <div className="sheet-handle-bar" />
      </div>
      <div className="sheet-header" onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd} onMouseDown={onDragStart} onMouseMove={onDragMove} onMouseUp={onDragEnd}>
        <span className="list-title">Nearby Trucks</span>
        <span className="list-count">{displayed.length} found</span>
      </div>

      <div className="sheet-content" ref={contentRef} onTouchStart={onContentDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}>
      <div className="list-search">
        <input className="list-search-input" type="text" placeholder="Search trucks…" value={searchText} onChange={e => setSearchText(e.target.value)} onFocus={() => setSnap("full")} />
        {searchText && <button className="list-search-clear" onClick={() => setSearchText("")} aria-label="Clear search">✕</button>}
      </div>

      <div className="list-filters">
        <button className={`filter-btn ${showFavoritesOnly ? "active" : ""}`} onClick={() => setShowFavoritesOnly(v => !v)}>
          {showFavoritesOnly ? "❤️" : "🤍"} Favorites
        </button>
        <button className={`filter-btn ${showOpenOnly ? "active" : ""}`} onClick={() => setShowOpenOnly(v => !v)}>
          Open only
        </button>
        <select className="filter-select" value={foodFilter} onChange={e => setFoodFilter(e.target.value)}>
          <option value="">All food</option>
          {foodTypes.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="distance">Nearest first</option>
          <option value="votes">Most voted</option>
        </select>
      </div>

      {displayed.length === 0 ? (
        <div className="list-empty">
          <div className="empty-icon">🔍</div>
          <p>
            {visibleTrucks.length === 0
              ? <>No trucks in this radius yet.<br />Try zooming out or adding one!</>
              : <>No trucks match your filters.<br />Try clearing them.</>}
          </p>
          {onFindNearest && <button className="btn-find-nearest" onClick={onFindNearest} aria-label="Find nearest truck">📍 Find nearest truck</button>}
        </div>
      ) : (
        displayed.map(truck => {
          const up = userVotes[truck.id] === 1;
          const down = userVotes[truck.id] === -1;
          const isMine = myTruckIds.includes(truck.id);
          const isEditing = editingId === truck.id;

          if (isEditing) return (
            <div key={truck.id}>
              <div className="truck-card-edit">
                <div className="form-row">
                  <input className="add-input" value={editName} maxLength={MAX_NAME_LENGTH} onChange={e => setEditName(e.target.value)} placeholder="Truck name…" />
                  <input className="add-input" value={editFood} maxLength={MAX_FOOD_LENGTH} onChange={e => setEditFood(e.target.value)} placeholder="Food type…" />
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={editOpen} onChange={e => setEditOpen(e.target.checked)} />
                  <span className="checkbox-label">🟢 Open right now</span>
                </label>
                <div className="edit-actions">
                  <button className="btn-edit-save" onClick={saveEdit}>Save changes</button>
                  <button className="btn-edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            </div>
          );

          const commentsOpen = openCommentsId === truck.id;

          return (
            <div key={truck.id}>
              <div className={`truck-card${truck.open ? " truck-open" : ""}`} onClick={() => onFocusTruck(truck.id)} style={{ cursor: "pointer" }}>
                <div className={`truck-card-emoji ${truck.open ? "open" : "closed"}`}>
                  {getFoodEmoji(truck.foodType)}
                </div>
                <div className="truck-card-info">
                  <div className="truck-card-name">{truck.name}{truck.isVerified && <span className="verified-badge" title="Verified"> ✅</span>} <span className={truck.open ? "open-tag" : "closed-tag"} role="status" aria-label={truck.open ? "Currently open" : "Currently closed"}>{truck.open ? "Open" : "Closed"}</span></div>
                  <div className="truck-card-sub">
                    {truck.street ? `${truck.foodType} on ${truck.street}` : truck.foodType}
                    &nbsp;·&nbsp; {truck.distance.toFixed(1)} mi
                  </div>
                  <div className="truck-card-hours">
                    {truck.isPermanent
                      ? truck.hours ? `📌 ${formatSchedule(truck.hours)}` : "📌 Permanent"
                      : `🚚 confirmed ${timeAgo(truck.lastConfirmedAt)}`}
                    &nbsp;&nbsp;
                    <span className={`score-pill ${truck.votes > 0 ? "positive" : truck.votes < 0 ? "negative" : ""}`}>
                      {truck.votes > 0 ? "▲" : truck.votes < 0 ? "▼" : "–"} {Math.abs(truck.votes)}
                    </span>
                  </div>
                </div>
                <div className="truck-card-actions">
                  <button className={`icon-btn icon-btn-fav ${favorites.includes(truck.id) ? "favorited" : ""}`} onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onToggleFavorite(truck.id); }} title="Favorite" aria-label="Favorite">{favorites.includes(truck.id) ? "❤️" : "🤍"}</button>
                  <div style={{ position: "relative" }}>
                    <button className={`icon-btn icon-btn-vote ${up ? "voted-up" : down ? "voted-down" : ""}`} onClick={e => { e.stopPropagation(); setOpenStatusId(null); setOpenVoteId(v => v === truck.id ? null : truck.id); }} title="Vote" aria-label="Vote">
                      {up ? "😊" : down ? "😞" : "🙂"}
                    </button>
                    {openVoteId === truck.id && (
                      <div className="vote-popup" onClick={e => e.stopPropagation()}>
                        <button className={`vote-popup-btn vote-popup-up`} onClick={() => { onVote(truck.id, 1); setOpenVoteId(null); }} disabled={up} title="Upvote" aria-label="Upvote">👍</button>
                        <button className={`vote-popup-btn vote-popup-down`} onClick={() => { onVote(truck.id, -1); setOpenVoteId(null); }} disabled={down} title="Downvote" aria-label="Downvote">👎</button>
                      </div>
                    )}
                  </div>
                  {isMine && (
                    <button className="icon-btn icon-btn-edit" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); startEdit(truck); }} title="Edit" aria-label="Edit truck">✏️</button>
                  )}
                  {isMine && (
                    <button className="icon-btn icon-btn-del" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onDeleteTruck(truck.id); }} title="Delete" aria-label="Delete truck">🗑</button>
                  )}
                  <button className={`icon-btn icon-btn-comment ${commentsOpen ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); setOpenCommentsId(v => v === truck.id ? null : truck.id); }} title="Comments" aria-label="Comments">💬{commentCounts[truck.id] ? <span className="comment-count-badge">{commentCounts[truck.id]}</span> : null}</button>
                  <button className="icon-btn icon-btn-share" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onShareTruck(truck.id); }} title="Share" aria-label="Share">🔗</button>
                  <button className="icon-btn icon-btn-nav" onClick={e => { e.stopPropagation(); logEvent("navigate_click", { truckId: truck.id }); window.open(`https://maps.google.com/maps?daddr=${truck.position[0]},${truck.position[1]}`, "_blank"); }} title="Navigate" aria-label="Navigate">🧭</button>
                </div>
              </div>
              {commentsOpen && <TruckComments truckId={truck.id} userId={userId} isAdmin={isAdmin} onAdminHideComment={onAdminHideComment} onAdminDeleteComment={onAdminDeleteComment} />}
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}

/* ─── Main App ──────────────────────────────────────────────────────────────── */
