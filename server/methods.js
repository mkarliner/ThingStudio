Meteor.methods({
	foreignConnections: function(){
		if(isAdmin(this.userId)) {
			c  =	Connections.find({$and: [{host: {$ne: "mqtt.thingstud.io"}}, {host: {$ne: "mqtt.modern-industry.com"}}]}).fetch();
			// console.log("FC: ", c)
			return c;
		}
	},
	screenDetails: function(id){
		if(isAdmin(this.userId)) {
			s = Screens.findOne({_id: id});
			if(s) {
				s.user = Users.findOne({_id: s.owner})
			}
			
			// console.log("FC: ", c)
			return s;
		}
	}
})