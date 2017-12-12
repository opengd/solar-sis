sudo npm install --unsafe-perm# Solar serial inverter system (solar-sis)

Universal inverter protocol handler specially for solar electricity systems

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. 

The system is also included in a prebuilt Raspberry PI image supplied by [DIY Tech & Repairs](http://diytechandrepairs.nu/raspberry-solar) You can also find alot of information regarding the main project on his [Youtube channel](https://www.youtube.com/user/daromeresperyd)


### Prerequisites

You will need to install Nodejs to run this project. Please visit [https://nodejs.org](https://nodejs.org) for more information how to install. You also need to install the nodejs package manager [npm](https://docs.npmjs.com/getting-started/installing-node) to get all dependencies.

Currently it only works with serialport 4.0.7 if you are running with the built in USB to Serial converter on the MPP inverters and chargers. This is an big issue but if you stick with 4.0.7 it works and also if you go with the pure serial interface. (This need to be bugged and sorted). The correct version of nodejs serialport package for this project will be installed by the solar-sis npm package scripts.

```
serialport 4.0.7
```

### Installing
n
You can install solar-sis with examples by clone this git repository or retrieve the [solar-sis npm package](https://www.npmjs.com/package/solar-sis).

**Using Git and npm**

Install by cloning git repository in your folder of choice.
```
git clone https://github.com/opengd/solar-sis.git

or as sudo:

sudo git clone https://github.com/opengd/solar-sis.git
```
This will retriev the solar-sis git repository. To use one of the example (MPI10kWHybrid, PCM60x, PIP4084..), go to the examaple of choice and retriev depended nodejs packages by using npm.

Install nodejs dependencies in example folder.
```
npm install

OR if you are using sudo or as root user:

sudo npm install --unsafe-perm
```
Now all dependencies for solar-sis should have been installed and you can run the service using Nodejs.

How to start a solar-sis example project.
```
node project.js

OR as sudo:

sudo node project.js

OR if calls.json and session.json have been renamed:

sudo node project.js my_new_calls.json my_new_session.json
```

Example installation:
```
sudo git clone https://github.com/opengd/solar-sis.git
cd solar-sis/example/PIP4084
sudo npm install --unsafe-perm
sudo node project.js
```

**Using npm**

Or you can use nodejs npm service to get solar-sis running, first get the solars-sis npm package in your folder of choice.
```
sudo npm install solar-sis --unsafe-perm
```
You should then find the example projects folder in "node_modules/solar-sis/example".

Choose an example and start the service by running the project.js file using Nodejs.
```
sudo node project.js
```

Example installation using npm:
```
sudo npm install solar-sis --unsafe-perm
cd node_modules/solar-sis/example/PIP4084
sudo node project.js
```

### Updating

To update solar-sis scripts using git just pull for updates in the solar-sis folder. This will update the example projects but not the node modules.
```
sudo git pull
```

To update the node modules in one of the example folders you will have to go to folder then and run npm update.
```
sudo npm update --unsafe-perm
```
This will get any new dependencies and update the old against the solar-sis npm package. 

## Running the tests

No tests exist in this project

## Contributing

Feel free to send in bugs/features or any other requests. We will take a look at them all and incorporate them as much as we can. 
If you want to contribute to the time its spent on this getting it here you can always contribute to the authors below via any of their Patreon/Paypal links

## Authors

* **Erik Johansson** - *Main developer* - [opengd](https://github.com/opengd)
* **Daniel Römer** - *Founder/brain/tester* - [daromer2](https://github.com/daromer2)

See also the list of [contributors](https://github.com/opengd/solar-sis/contributors) who participated in this project.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Acknowledgments

* Hat tip to anyone who's code was used
* Inspiration
* etc

