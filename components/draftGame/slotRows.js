/** The seat's slots in order, each with the pick roomState assigned to it (or none). PURE. */
export function slotRows(slots, picks) {
  const left = [...picks];
  return slots.map((slot) => {
    const i = left.findIndex((x) => x.slot === slot);
    return { slot, p: i >= 0 ? left.splice(i, 1)[0] : null };
  });
}
