export async function postGuestTransfer(body) {
  const response = await fetch('/api/guest-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()).result;
}
