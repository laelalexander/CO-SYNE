// Pilot geography: City of Tulsa (urban, Tulsa Police divisions) with
// north Tulsa County (rural, Sheriff's Office), so routing is exercised
// across both urban and rural coverage.
export const REGION = { name: 'Tulsa, Oklahoma', center: { lat: 36.1300, lng: -95.9370 }, zoom: 12 };

export const CENTERS = [
  { id: 'tulsa-911', name: 'Tulsa 911 Emergency Communications', area: 'urban', location: { lat: 36.1517, lng: -95.9978 } },
  { id: 'tcso-north', name: 'Tulsa County Sheriff Dispatch (North County)', area: 'rural', location: { lat: 36.3680, lng: -96.0010 } },
];

export function seedUnits() {
  return [
    { id: 'u-tpd-r214', callsign: 'Riverside 214', type: 'police', area: 'urban', agency: 'Tulsa Police Department', status: 'available', location: { lat: 36.0940, lng: -95.9700 }, simulated: true },
    { id: 'u-tpd-g122', callsign: 'Gilcrease 122', type: 'police', area: 'urban', agency: 'Tulsa Police Department', status: 'available', location: { lat: 36.1930, lng: -95.9870 }, simulated: true },
    { id: 'u-tpd-m318', callsign: 'Mingo Valley 318', type: 'police', area: 'urban', agency: 'Tulsa Police Department', status: 'available', location: { lat: 36.1290, lng: -95.8620 }, simulated: true },
    { id: 'u-tcso-41', callsign: 'TCSO 41', type: 'police', area: 'rural', agency: "Tulsa County Sheriff's Office", status: 'available', location: { lat: 36.3550, lng: -95.9870 }, simulated: true },
    { id: 'u-emsa-141', callsign: 'EMSA Medic 141', type: 'ems', area: 'urban', status: 'available', location: { lat: 36.1450, lng: -95.9650 } },
    { id: 'u-emsa-157', callsign: 'EMSA Medic 157', type: 'ems', area: 'rural', status: 'available', location: { lat: 36.3300, lng: -95.9600 } },
    { id: 'u-tfd-e21', callsign: 'TFD Engine 21', type: 'fire', area: 'urban', status: 'available', location: { lat: 36.1180, lng: -95.9450 } },
    { id: 'u-tow-7', callsign: 'Tow 7', type: 'tow', area: 'urban', status: 'available', location: { lat: 36.1600, lng: -95.9200 } },
  ];
}

// Simulated patrol units cruise inside their beat while available, so the
// dispatch map shows a live picture.
export const BEATS = {
  'u-tpd-r214': { lat: 36.0940, lng: -95.9700, r: 0.025 },
  'u-tpd-g122': { lat: 36.1930, lng: -95.9870, r: 0.025 },
  'u-tpd-m318': { lat: 36.1290, lng: -95.8620, r: 0.025 },
  'u-tcso-41': { lat: 36.3550, lng: -95.9870, r: 0.04 },
};
