export function getNetBirdAddresses(interfaces) {
  const adapter = Object.entries(interfaces).find(([name]) => /^wt\d*$/i.test(name));
  return [
    ...new Set(
      (adapter?.[1] || [])
        .filter((address) => {
          if (address.internal) return false;
          if (address.family === 'IPv4')
            return /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address.address);
          return address.family === 'IPv6' && /^f[cd][0-9a-f]{2}:/i.test(address.address);
        })
        .map((address) => address.address),
    ),
  ];
}
