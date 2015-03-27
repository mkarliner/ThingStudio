

  Meteor.startup(function () {
    // code to run on server at startup
	 // console.log(Connections.find({}).fetch());
	  
	  
	  
	  Meteor.publish("connections", function(){
	  	return Connections.find({$or: [{owner: this.userId}]});
	  });

	  Meteor.publish("screens", function(){
	  	return Screens.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("feeds", function(){
	  	return Feeds.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("themes", function(){
	  	return Themes.find({$or: [{owner: this.userId}, {public: true}]});
	  });
	  Meteor.publish("help_pages", function(){
	  	return HelpPages.find({}, {sort: {pagenumber: 1}});
	  });
	  Meteor.publish("userData", function () {
		  user = Meteor.users.find({_id: this.userId});
		  if(user.roles && user.roles['admin']) {
		  	return Meteor.users.find({});
		  } else {
			 this.ready();
		  }
	  });
	  
	  Meteor.publish("userStatus", function() {
	    return Meteor.users.find({ "status.online": true }, { fields: { emails: 1 } });
	  });
	  
	  
	  var ascoltatore = {
	  	//using ascoltatore
	  	type: 'mongo',
	  	url: 'mongodb://localhost:3001/mqtt',
	  	pubsubCollection: 'ascoltatori',
	  	mongo: {}
	  };

	  var moscaSettings = {
	  	port: 1883,
	  	backend: ascoltatore,
	  	persistence: {
	  		factory: mosca.persistence.Mongo,
	  		url: 'mongodb://localhost:3001/mqtt'
	  	},
	  	http: {
	  		port: 9001,
	  		bundle: true,
	  		static: './'
	  	}
	  };


	  // var server = new mosca.Server(moscaSettings);
	  // server.on('ready', setup);

	  // fired when the mqtt server is ready 

	  function setup() {
	  	console.log('Mosca server is up and running');
	  }
	  

  });

