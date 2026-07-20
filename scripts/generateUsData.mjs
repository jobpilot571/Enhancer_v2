import fs from 'fs'

const STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
]

const CITIES = {
  AL: ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison', 'Florence', 'Gadsden', 'Vestavia Hills', 'Prattville', 'Phenix City'],
  AK: ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan', 'Wasilla', 'Kenai', 'Kodiak', 'Bethel', 'Palmer'],
  AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Gilbert', 'Tempe', 'Peoria', 'Surprise', 'Yuma', 'Avondale', 'Goodyear', 'Flagstaff', 'Buckeye', 'Casa Grande', 'Lake Havasu City', 'Maricopa'],
  AR: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'North Little Rock', 'Conway', 'Rogers', 'Pine Bluff', 'Bentonville', 'Hot Springs', 'Benton', 'Sherwood', 'Texarkana', 'Russellville'],
  CA: ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim', 'Santa Ana', 'Riverside', 'Stockton', 'Irvine', 'Chula Vista', 'Fremont', 'San Bernardino', 'Modesto', 'Fontana', 'Moreno Valley', 'Oxnard', 'Huntington Beach', 'Glendale', 'Santa Clarita', 'Garden Grove', 'Oceanside', 'Rancho Cucamonga', 'Santa Rosa', 'Ontario', 'Elk Grove', 'Corona', 'Lancaster', 'Palmdale', 'Salinas', 'Hayward', 'Pomona', 'Escondido', 'Sunnyvale', 'Torrance', 'Pasadena', 'Orange', 'Fullerton', 'Roseville', 'Visalia', 'Concord', 'Santa Clara', 'Vallejo', 'Victorville', 'Berkeley', 'El Monte', 'Downey', 'Costa Mesa', 'Inglewood', 'Carlsbad', 'San Mateo', 'Fairfield', 'Richmond', 'Antioch', 'Daly City', 'Temecula', 'Clovis', 'Murrieta', 'Norwalk', 'Vista', 'El Cajon', 'Burbank', 'San Leandro', 'Rialto', 'Jurupa Valley', 'Compton', 'South Gate', 'Mission Viejo', 'Vacaville', 'Carson', 'Hesperia', 'Santa Monica', 'Westminster', 'Redding', 'Santa Barbara', 'Chico', 'Newport Beach', 'San Marcos', 'Hemet', 'Indio', 'Menifee'],
  CO: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial', 'Boulder', 'Greeley', 'Longmont', 'Loveland', 'Broomfield', 'Grand Junction', 'Castle Rock', 'Commerce City', 'Parker', 'Littleton'],
  CT: ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden', 'Milford', 'West Haven', 'Middletown', 'Norwich', 'Shelton'],
  DE: ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle'],
  DC: ['Washington'],
  FL: ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Port St. Lucie', 'Cape Coral', 'Tallahassee', 'Fort Lauderdale', 'Pembroke Pines', 'Hollywood', 'Gainesville', 'Miramar', 'Coral Springs', 'Clearwater', 'Miami Gardens', 'Palm Bay', 'West Palm Beach', 'Pompano Beach', 'Lakeland', 'Davie', 'Miami Beach', 'Sunrise', 'Plantation', 'Boca Raton', 'Deltona', 'Largo', 'Melbourne', 'Palm Coast', 'Deerfield Beach', 'Boynton Beach', 'Lauderhill', 'Weston', 'Fort Myers', 'Kissimmee', 'Homestead', 'Tamarac', 'Delray Beach', 'Daytona Beach', 'North Miami', 'Wellington', 'North Port', 'Jupiter', 'Ocala', 'Port Orange', 'Margate', 'Coconut Creek', 'Sanford', 'Sarasota'],
  GA: ['Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany', 'Warner Robins', 'Alpharetta', 'Marietta', 'Valdosta', 'Smyrna', 'Dunwoody', 'Rome', 'East Point', 'Peachtree Corners', 'Gainesville'],
  HI: ['Honolulu', 'East Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani Town', 'Kahului', 'Ewa Gentry'],
  ID: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Caldwell', 'Pocatello', "Coeur d'Alene", 'Twin Falls', 'Post Falls', 'Lewiston', 'Rexburg', 'Eagle', 'Moscow', 'Kuna', 'Ammon'],
  IL: ['Chicago', 'Aurora', 'Joliet', 'Naperville', 'Rockford', 'Elgin', 'Springfield', 'Peoria', 'Waukegan', 'Champaign', 'Cicero', 'Bloomington', 'Arlington Heights', 'Evanston', 'Schaumburg', 'Bolingbrook', 'Decatur', 'Palatine', 'Skokie', 'Des Plaines', 'Orland Park', 'Tinley Park', 'Oak Lawn', 'Berwyn', 'Mount Prospect', 'Normal', 'Wheaton', 'Hoffman Estates', 'Oak Park', 'Downers Grove'],
  IN: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette', 'Muncie', 'Terre Haute', 'Kokomo', 'Anderson', 'Noblesville', 'Greenwood', 'Elkhart', 'Mishawaka', 'Lawrence', 'Jeffersonville'],
  IA: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo', 'Ames', 'West Des Moines', 'Council Bluffs', 'Ankeny', 'Dubuque', 'Urbandale', 'Cedar Falls', 'Marion', 'Bettendorf'],
  KS: ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka', 'Lawrence', 'Shawnee', 'Manhattan', 'Lenexa', 'Salina', 'Hutchinson', 'Leavenworth', 'Leawood', 'Dodge City', 'Garden City'],
  KY: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Hopkinsville', 'Nicholasville', 'Elizabethtown', 'Henderson', 'Jeffersontown', 'Frankfort', 'Paducah'],
  LA: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City', 'Monroe', 'Alexandria', 'Houma', 'New Iberia', 'Central', 'Slidell', 'Ruston', 'Sulphur'],
  ME: ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn', 'Biddeford', 'Sanford', 'Saco', 'Augusta', 'Westbrook', 'Waterville', 'Presque Isle', 'Brewer', 'Bath', 'Caribou'],
  MD: ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Bowie', 'Hagerstown', 'Annapolis', 'College Park', 'Salisbury', 'Laurel', 'Greenbelt', 'Cumberland', 'Westminster', 'Hyattsville', 'Takoma Park'],
  MA: ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Brockton', 'New Bedford', 'Quincy', 'Lynn', 'Fall River', 'Newton', 'Lawrence', 'Somerville', 'Framingham', 'Haverhill', 'Waltham', 'Malden', 'Brookline', 'Plymouth', 'Medford', 'Taunton', 'Chicopee', 'Weymouth', 'Revere', 'Peabody'],
  MI: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Dearborn', 'Clinton Township', 'Canton', 'Livonia', 'Troy', 'Westland', 'Farmington Hills', 'Flint', 'Southfield', 'Wyoming', 'Rochester Hills', 'Kalamazoo', 'Novi', 'Taylor', 'Dearborn Heights', 'Pontiac', 'St. Clair Shores', 'Royal Oak'],
  MN: ['Minneapolis', 'St. Paul', 'Rochester', 'Bloomington', 'Duluth', 'Brooklyn Park', 'Plymouth', 'Woodbury', 'Maple Grove', 'St. Cloud', 'Eagan', 'Eden Prairie', 'Coon Rapids', 'Burnsville', 'Blaine', 'Lakeville', 'Minnetonka', 'Apple Valley', 'Edina', 'St. Louis Park'],
  MS: ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi', 'Meridian', 'Tupelo', 'Greenville', 'Olive Branch', 'Horn Lake', 'Clinton', 'Pearl', 'Madison', 'Starkville', 'Ridgeland'],
  MO: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence', "Lee's Summit", "O'Fallon", 'St. Joseph', 'St. Charles', 'Blue Springs', 'Joplin', 'Florissant', 'Chesterfield', 'Jefferson City', 'Cape Girardeau'],
  MT: ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Havre', 'Anaconda', 'Miles City', 'Belgrade', 'Livingston', 'Laurel', 'Whitefish', 'Lewistown'],
  NE: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'Columbus', 'Papillion', 'North Platte', 'La Vista', 'Scottsbluff', 'South Sioux City', 'Beatrice'],
  NV: ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City', 'Fernley', 'Elko', 'Mesquite', 'Boulder City', 'Fallon', 'Winnemucca', 'West Wendover', 'Ely', 'Yerington'],
  NH: ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover', 'Rochester', 'Salem', 'Merrimack', 'Hudson', 'Londonderry', 'Keene', 'Bedford', 'Portsmouth', 'Goffstown', 'Laconia'],
  NJ: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Lakewood', 'Edison', 'Woodbridge', 'Toms River', 'Hamilton', 'Trenton', 'Clifton', 'Camden', 'Brick', 'Cherry Hill', 'Passaic', 'Union City', 'Bayonne', 'East Orange', 'Vineland', 'New Brunswick', 'Perth Amboy', 'Hoboken', 'Plainfield', 'West New York', 'Hackensack'],
  NM: ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell', 'Farmington', 'Clovis', 'Hobbs', 'Alamogordo', 'Carlsbad', 'Gallup', 'Deming', 'Los Lunas', 'Chaparral', 'Sunland Park'],
  NY: ['New York', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse', 'Albany', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica', 'White Plains', 'Hempstead', 'Troy', 'Niagara Falls', 'Binghamton', 'Freeport', 'Valley Stream', 'Long Beach', 'Rome', 'Ithaca', 'Poughkeepsie', 'North Tonawanda', 'Jamestown', 'Elmira', 'Newburgh'],
  NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Asheville', 'Greenville', 'Gastonia', 'Jacksonville', 'Chapel Hill', 'Rocky Mount', 'Huntersville', 'Burlington', 'Wilson', 'Kannapolis'],
  ND: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo', 'Williston', 'Dickinson', 'Mandan', 'Jamestown', 'Wahpeton', 'Devils Lake', 'Watford City', 'Valley City', 'Grafton', 'Beulah'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain', 'Hamilton', 'Springfield', 'Kettering', 'Elyria', 'Lakewood', 'Cuyahoga Falls', 'Middletown', 'Newark', 'Euclid', 'Mentor', 'Mansfield', 'Beavercreek', 'Cleveland Heights', 'Strongsville', 'Dublin'],
  OK: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton', 'Moore', 'Midwest City', 'Enid', 'Stillwater', 'Owasso', 'Bartlesville', 'Muskogee', 'Shawnee', 'Bixby'],
  OR: ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis', 'Albany', 'Tigard', 'Lake Oswego', 'Keizer', 'Grants Pass', 'Oregon City', 'McMinnville', 'Redmond', 'Tualatin', 'West Linn'],
  PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'York', 'Erie', 'Altoona', 'Wilkes-Barre', 'State College', 'Chester', 'Easton', 'Lebanon', 'Williamsport', 'Hazleton', 'New Castle', 'Johnstown'],
  RI: ['Providence', 'Cranston', 'Warwick', 'Pawtucket', 'East Providence', 'Woonsocket', 'Coventry', 'Cumberland', 'North Providence', 'South Kingstown', 'West Warwick', 'Johnston', 'North Kingstown', 'Newport', 'Westerly'],
  SC: ['Charleston', 'Columbia', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville', 'Summerville', 'Sumter', 'Goose Creek', 'Hilton Head Island', 'Florence', 'Spartanburg', 'Myrtle Beach', 'Aiken', 'Greer'],
  SD: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown', 'Mitchell', 'Yankton', 'Pierre', 'Huron', 'Vermillion', 'Spearfish', 'Brandon', 'Box Elder', 'Madison', 'Sturgis'],
  TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Bartlett', 'Hendersonville', 'Kingsport', 'Collierville', 'Smyrna', 'Cleveland', 'Brentwood', 'Germantown', 'Columbia', 'Spring Hill', 'Gallatin'],
  TX: ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo', 'Lubbock', 'Garland', 'Irving', 'Frisco', 'McKinney', 'Amarillo', 'Grand Prairie', 'Brownsville', 'Killeen', 'Pasadena', 'Mesquite', 'McAllen', 'Waco', 'Denton', 'Carrollton', 'Midland', 'Abilene', 'Beaumont', 'Round Rock', 'Odessa', 'Pearland', 'Richardson', 'Sugar Land', 'College Station', 'The Woodlands', 'League City', 'Lewisville', 'Tyler', 'Allen', 'Edinburg', 'Mission', 'Longview', 'Pharr', 'Baytown', 'Missouri City', 'Temple', 'Flower Mound', 'New Braunfels', 'North Richland Hills', 'Conroe'],
  UT: ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Sandy', 'Ogden', 'St. George', 'Layton', 'South Jordan', 'Lehi', 'Millcreek', 'Taylorsville', 'Logan', 'Murray', 'Draper', 'Bountiful', 'Riverton', 'Herriman', 'Spanish Fork'],
  VT: ['Burlington', 'South Burlington', 'Rutland', 'Barre', 'Montpelier', 'Winooski', 'St. Albans', 'Newport', 'Vergennes', 'Middlebury', 'St. Johnsbury', 'Brattleboro', 'Essex Junction', 'Bennington'],
  VA: ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk', 'Lynchburg', 'Harrisonburg', 'Leesburg', 'Charlottesville', 'Danville', 'Manassas', 'Petersburg', 'Fredericksburg', 'Winchester', 'Salem'],
  WA: ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Spokane Valley', 'Federal Way', 'Yakima', 'Kirkland', 'Bellingham', 'Kennewick', 'Auburn', 'Pasco', 'Marysville', 'Lakewood', 'Redmond', 'Sammamish', 'Richland', 'Shoreline', 'Olympia', 'Lacey', 'Burien'],
  WV: ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Martinsburg', 'Beckley', 'Clarksburg', 'South Charleston', 'St. Albans', 'Vienna', 'Bluefield'],
  WI: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire', 'Oshkosh', 'Janesville', 'West Allis', 'La Crosse', 'Sheboygan', 'Wauwatosa', 'Fond du Lac', 'New Berlin', 'Wausau', 'Brookfield', 'Beloit', 'Greenfield', 'Franklin', 'Oak Creek', 'Manitowoc', 'West Bend', 'Sun Prairie'],
  WY: ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs', 'Sheridan', 'Green River', 'Evanston', 'Riverton', 'Jackson', 'Cody', 'Rawlins', 'Lander', 'Torrington', 'Powell'],
}

fs.mkdirSync('src/data', { recursive: true })

const loc = `/** US states and major cities for JD Builder location dropdowns. */
export const US_STATES = ${JSON.stringify(STATES.map(([value, label]) => ({ value, label })), null, 2)}

/** Cities keyed by 2-letter state code. */
export const US_CITIES_BY_STATE = ${JSON.stringify(CITIES, null, 2)}

export function citiesForState(stateCode) {
  const code = String(stateCode || '').trim().toUpperCase()
  const list = US_CITIES_BY_STATE[code] || []
  return list.map((c) => ({ value: c, label: c }))
}

export const US_STATE_OPTIONS = [
  ...US_STATES,
  { value: 'Remote', label: 'Remote' },
  { value: 'Other', label: 'Other' },
]
`
fs.writeFileSync('src/data/usLocations.js', loc)
console.log('wrote usLocations.js', loc.length)
