Template.GetMyCredentials.helpers({
	
	connectionName: function() {
		return this.connectionName;
	},
	connectionHost: function(){
		return this.connectionHost;
	},
	context: function(){
		console.log("CONTEXT", this)
	}
});

Template.GetMyCredentials.events({
	// 'submit #credentials-form': function(e, t){
	// 	console.log("Helolo there")
	// 	e.preventDefault();
	// 	var username = t.find("#credentials-username").value;
	// 	var password = t.find("#credentials-password").value;
	//
	// 	console.log("Credentials: ", username, password)
	// },
	// 'click': function(e, t){
	// 	console.log("Helolo there")
	// 	e.preventDefault();
	// 	var username = t.find("#credentials-username").value;
	// 	var password = t.find("#credentials-password").value;
	//
	// 	console.log("Credentials: ", username, password)
	// }
	
})