// Revalidate on returning to the page, without reloading or clearing form state.
export function subscribeToTabReturn(refresh, target = window, page = document) {
  let timer;
  function schedule() {
    if (page.visibilityState === 'hidden') return;
    clearTimeout(timer);
    // Focus and visibilitychange often arrive together. Fetch just once.
    timer = setTimeout(refresh, 0);
  }
  target.addEventListener('focus', schedule);
  page.addEventListener('visibilitychange', schedule);
  return () => {
    clearTimeout(timer);
    target.removeEventListener('focus', schedule);
    page.removeEventListener('visibilitychange', schedule);
  };
}
