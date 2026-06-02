const db = require("./database");

const demoBusinesses = [
  ["Muslim Ad Network", "United Kingdom"],
  ["Deen Developers", "United States"],
  ["Halal Booking Hub", "United Kingdom"],
  ["Modest Market", "Canada"],
  ["Barakah Finance", "United States"],
  ["Ummah Studios", "Australia"],
  ["Sunnah Supply Co", "United Kingdom"],
  ["Halal Health Tech", "Malaysia"],
  ["Zakat Solutions", "United Arab Emirates"],
  ["Muslim Founders Club", "Global / Online"],
  ["Iqra Learning", "Pakistan"],
  ["Taqwa Foods", "United Kingdom"],
  ["Noor Digital", "Canada"],
  ["Hajj Assist", "Saudi Arabia"],
  ["Sabr Coaching", "United States"],
  ["HalalPay", "United Arab Emirates"],
  ["Madinah Media", "Saudi Arabia"],
  ["Amanah Legal", "United Kingdom"],
  ["Startup Ummah", "Global / Online"],
  ["FaithTech Labs", "Global / Online"]
];

demoBusinesses.forEach(([business_name, business_location]) => {
  db.run(
    `
    INSERT INTO directories 
    (
      business_name,
      business_location,
      description,
      logo_image
    )
    VALUES (?, ?, ?, ?)
    `,
    [
      business_name,
      business_location,
      `${business_name} is a demo business listing added for testing the directory portal.`,
      ""
    ]
  );
});

console.log("20 demo businesses added successfully.");