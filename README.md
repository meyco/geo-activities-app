# tripadvisor-project
 Final Project in the JavaScript Course at ReDI School

# Setup guide for the Weather-Based Activity Suggestion Service

We have developed a service that suggests activities based on weather forecasts. This service comes in two versions:

1. HTML Version: Simply open the file in a browser to use.`tripadvisor-project/public/FinalProject.html`
1. Node.js Version: Requires setting up a local server.


This document explains the setup process for `version 2`, the Node.js version.
This application uses the Tripadvisor API, which is free for up to 5000 calls. To use this API, you need to set up either **domain restrictions or IP address restrictions**.


#　Preparation for Tripadvisor API Use

1. Visit Tripadvisor Developers and create an account.  `https://www.tripadvisor.com/developers`
1. Check your IP address here `https://whatismyipaddress.com/`
1. In the My API menu, register your current IP address, appending `/32` to the end. For example, if your IP address is `99.123.123.12`, register it as `99.123.123.12/32`.
1. Copy the API key from the My API menu and add it to **line 9 of server.js** in the tripadvisor-project folder.


# Application Setup Steps

1. Open Terminal and navigate to the project directory using the following command:`cd /path/to/your/tripadvisor-project` (After entering `cd　`, it’s convenient to drag and drop the folder into the terminal window.)
1. Start the server by running the following command in Terminal:`node server.js`
1. Open your browser and go to `http://localhost:3000` to use the application.
1. With these steps, you are ready to use the weather-based activity suggestion service locally.
