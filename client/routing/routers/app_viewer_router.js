Router.route("/viewer/screen/:_id", {
	name: "View Screen",
	controller: "AppViewerController",
	action: "action",
	where: "client"
});

Router.route("/view/app/:_id", {
	onBeforeAction: function(){
		Session.set("currentAppId", this.params._id);
	},
	action: "selectTemplate",
	name: "ViewApp"
});