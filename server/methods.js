Meteor.methods({
	foreignConnections: function(){
		if(isAdmin(this.userId)) {
			c  =	Connections.find({$and: [{host: {$ne: "mqtt.thingstud.io"}}, {host: {$ne: "mqtt.modern-industry.com"}}]}).fetch();
			// console.log("FC: ", c)
			return c;
		}
	}
})