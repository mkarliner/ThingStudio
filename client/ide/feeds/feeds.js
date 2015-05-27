Template.DataFeedsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.DataFeedsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		menuOps();
	}
});

Template.DataFeedsBody.helpers({
	feedlist: function(){
		return Feeds.find({owner: Meteor.userId()}, {sort: {createdAt: -1}})
	},
	publicfeeds: function() {
		return Feeds.find({public: true})
	},
	ownerName: function(){
		owner = Meteor.users.findOne({_id: this.owner});
		return owner ? owner.username : "Owner Unknown";
	},
	beforeRemove: function () {
		return function (collection, id) {
			var doc = collection.findOne(id);
			// if (confirm('Really delete "' + doc.title + '"?')) {
			// 	
			// }
			$('#modal1').leanModal({
				
				dismissible: true, // Modal can be dismissed by clicking outside of the modal
				opacity: .5, // Opacity of modal background
				in_duration: 300, // Transition in duration
				out_duration: 200, // Transition out duration
				ready: function() {
					console.log("This in the modal is: " + this);
				 }, // Callback for Modal open
				complete: function() { 
					this.remove();
				} // Callback for Modal close
			});
			$('#modal1').openModal();
		};
	}
});

Meteor.startup(function(){
	Feeds.after.insert(function(userId, doc) {
		// console.log("New Feed: ", userId, doc);
		mqttClient.subscribe(doc.subscription);
	});
	Feeds.after.update(function(userId, doc) {
		// console.log("Updated Feed: ", userId, doc);
		mqttClient.subscribe(doc.subscription);
	});
});