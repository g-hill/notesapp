import { useState, useEffect } from "react";
import {
  Authenticator,
  Button,
  Text,
  TextField,
  Heading,
  Flex,
  View,
  Image,
  Grid,
  Divider,
  Alert,
  TabItem,
  Tabs,
  Card,
  Badge,
} from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import "@aws-amplify/ui-react/styles.css";
import { getUrl } from "aws-amplify/storage";
import { uploadData } from "aws-amplify/storage";
import { generateClient } from "aws-amplify/data";
import { getCurrentUser } from "aws-amplify/auth";
import outputs from "../amplify_outputs.json";

/**
 * @type {import('aws-amplify/data').Client<import('../amplify/data/resource').Schema>}
 */

Amplify.configure(outputs);
const client = generateClient({
  authMode: "userPool",
});

export default function App() {
  const [notes, setNotes] = useState([]);
  const [friendsNotes, setFriendsNotes] = useState([]);
  const [friendEmail, setFriendEmail] = useState("");
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState("my-notes");
  const [alertInfo, setAlertInfo] = useState({ show: false, message: "", type: "info" });

  useEffect(() => {
    fetchCurrentUser();
    fetchNotes();
    fetchFriends();
    fetchFriendRequests();
  }, []);

  async function fetchCurrentUser() {
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
    } catch (error) {
      console.error("Error fetching current user:", error);
    }
  }

  async function fetchNotes() {
    try {
      const { data: notes } = await client.models.Note.list();
      await Promise.all(
        notes.map(async (note) => {
          if (note.image) {
            const linkToStorageFile = await getUrl({
              path: ({ identityId }) => `media/${identityId}/${note.image}`,
            });
            note.image = linkToStorageFile.url;
          }
          return note;
        })
      );
      setNotes(notes);
    } catch (error) {
      console.error("Error fetching notes:", error);
      showAlert("Failed to fetch notes", "error");
    }
  }

  async function fetchFriendsNotes() {
    try {
      if (friends.length === 0) return;
      
      const friendEmails = friends.map(friend => friend.email);
      const { data: allNotes } = await client.models.Note.list();
      
      // Filter notes that belong to friends and are shared
      const sharedNotes = allNotes.filter(note => 
        note.owner && friendEmails.includes(note.owner) && note.shared
      );
      
      await Promise.all(
        sharedNotes.map(async (note) => {
          if (note.image) {
            try {
              const linkToStorageFile = await getUrl({
                path: ({ identityId }) => `media/${identityId}/${note.image}`,
              });
              note.image = linkToStorageFile.url;
            } catch (error) {
              console.error("Error fetching image for note:", error);
              note.image = null;
            }
          }
          return note;
        })
      );
      
      setFriendsNotes(sharedNotes);
    } catch (error) {
      console.error("Error fetching friends' notes:", error);
      showAlert("Failed to fetch friends' notes", "error");
    }
  }

  async function fetchFriends() {
    try {
      const { data: friendships } = await client.models.Friendship.list({
        filter: {
          status: { eq: "ACCEPTED" }
        }
      });
      
      // Get friends where current user is either the requester or receiver
      const userEmail = currentUser?.username;
      const userFriends = friendships.filter(friendship => 
        friendship.requesterEmail === userEmail || friendship.receiverEmail === userEmail
      );
      
      // Transform to a more usable format
      const friendsList = userFriends.map(friendship => {
        const isRequester = friendship.requesterEmail === userEmail;
        return {
          id: friendship.id,
          email: isRequester ? friendship.receiverEmail : friendship.requesterEmail,
          status: friendship.status
        };
      });
      
      setFriends(friendsList);
      
      // After fetching friends, fetch their notes
      if (friendsList.length > 0) {
        fetchFriendsNotes();
      }
    } catch (error) {
      console.error("Error fetching friends:", error);
      showAlert("Failed to fetch friends list", "error");
    }
  }

  async function fetchFriendRequests() {
    try {
      const userEmail = currentUser?.username;
      if (!userEmail) return;
      
      const { data: pendingRequests } = await client.models.Friendship.list({
        filter: {
          receiverEmail: { eq: userEmail },
          status: { eq: "PENDING" }
        }
      });
      
      setFriendRequests(pendingRequests);
    } catch (error) {
      console.error("Error fetching friend requests:", error);
      showAlert("Failed to fetch friend requests", "error");
    }
  }

  async function createNote(event) {
    event.preventDefault();
    try {
      const form = new FormData(event.target);
      const shared = form.get("shared") === "on";
      
      const { data: newNote } = await client.models.Note.create({
        name: form.get("name"),
        description: form.get("description"),
        image: form.get("image")?.name || null,
        task: form.get("task"),
        shared: shared,
        owner: currentUser?.username
      });
      
      if (newNote.image && form.get("image")?.size > 0) {
        await uploadData({
          path: ({ identityId }) => `media/${identityId}/${newNote.image}`,
          data: form.get("image"),
        }).result;
      }
      
      fetchNotes();
      event.target.reset();
      showAlert("Note created successfully!", "success");
    } catch (error) {
      console.error("Error creating note:", error);
      showAlert("Failed to create note", "error");
    }
  }

  async function deleteNote({ id }) {
    try {
      const toBeDeletedNote = { id };
      const { data: deletedNote } = await client.models.Note.delete(toBeDeletedNote);
      fetchNotes();
      fetchFriendsNotes();
      showAlert("Note deleted successfully", "success");
    } catch (error) {
      console.error("Error deleting note:", error);
      showAlert("Failed to delete note", "error");
    }
  }

  async function sendFriendRequest(event) {
    event.preventDefault();
    
    if (!friendEmail) {
      showAlert("Please enter a friend's email address", "warning");
      return;
    }
    
    // Don't allow adding yourself
    if (friendEmail === currentUser?.username) {
      showAlert("You cannot add yourself as a friend", "warning");
      return;
    }
    
    // Check if already friends
    const alreadyFriend = friends.some(friend => friend.email === friendEmail);
    if (alreadyFriend) {
      showAlert("You are already friends with this user", "warning");
      return;
    }
    
    // Check if request already sent
    const { data: existingRequests } = await client.models.Friendship.list({
      filter: {
        requesterEmail: { eq: currentUser?.username },
        receiverEmail: { eq: friendEmail },
      }
    });
    
    if (existingRequests.length > 0) {
      showAlert("Friend request already sent", "warning");
      return;
    }
    
    try {
      await client.models.Friendship.create({
        requesterEmail: currentUser?.username,
        receiverEmail: friendEmail,
        status: "PENDING"
      });
      
      setFriendEmail("");
      showAlert("Friend request sent successfully!", "success");
    } catch (error) {
      console.error("Error sending friend request:", error);
      showAlert("Failed to send friend request", "error");
    }
  }

  async function handleFriendRequest(requestId, accept) {
    try {
      if (accept) {
        await client.models.Friendship.update({
          id: requestId,
          status: "ACCEPTED"
        });
        showAlert("Friend request accepted", "success");
      } else {
        await client.models.Friendship.delete({
          id: requestId
        });
        showAlert("Friend request declined", "info");
      }
      
      fetchFriendRequests();
      fetchFriends();
    } catch (error) {
      console.error("Error handling friend request:", error);
      showAlert("Failed to process friend request", "error");
    }
  }

  async function removeFriend(friendshipId) {
    try {
      await client.models.Friendship.delete({
        id: friendshipId
      });
      
      fetchFriends();
      showAlert("Friend removed successfully", "info");
    } catch (error) {
      console.error("Error removing friend:", error);
      showAlert("Failed to remove friend", "error");
    }
  }

  function showAlert(message, type = "info") {
    setAlertInfo({ show: true, message, type });
    setTimeout(() => {
      setAlertInfo({ show: false, message: "", type: "info" });
    }, 5000);
  }

  return (
    <Authenticator>
      {({ signOut }) => (
        <Flex
          className="App"
          justifyContent="center"
          alignItems="center"
          direction="column"
          width="80%"
          margin="0 auto"
        >
          <Heading level={1}>My Notes App</Heading>
          
          {alertInfo.show && (
            <Alert
              variation={alertInfo.type}
              isDismissible={true}
              margin="1rem 0"
              width="100%"
            >
              {alertInfo.message}
            </Alert>
          )}
          
          <Tabs
            justifyContent="center"
            width="100%"
            spacing="equal"
            margin="2rem 0"
            currentIndex={activeTab === "my-notes" ? 0 : activeTab === "friends-notes" ? 1 : 2}
            onChange={(index) => setActiveTab(index === 0 ? "my-notes" : index === 1 ? "friends-notes" : "friends")}
          >
            <TabItem title="My Notes">
              <View as="form" margin="2rem 0" onSubmit={createNote}>
                <Flex
                  direction="column"
                  justifyContent="center"
                  gap="1.5rem"
                  padding="2rem"
                  width="100%"
                >
                  <TextField
                    name="name"
                    placeholder="Note Name"
                    label="Note Name"
                    variation="quiet"
                    required
                  />
                  <TextField
                    name="description"
                    placeholder="Note Description"
                    label="Note Description"
                    variation="quiet"
                    required
                  />
                  <TextField
                    name="task"
                    placeholder="Note Task"
                    label="Note Task"
                    variation="quiet"
                    required
                  />
                  <Flex alignItems="center" gap="1rem">
                    <Text>Share with friends:</Text>
                    <input type="checkbox" name="shared" />
                  </Flex>
                  <View
                    name="image"
                    as="input"
                    type="file"
                    alignSelf="start"
                    accept="image/png, image/jpeg"
                  />
                  <Button type="submit" variation="primary">
                    Create Note
                  </Button>
                </Flex>
              </View>
              
              <Divider />
              
              <Heading level={2}>My Notes</Heading>
              <Grid
                templateColumns="1fr 1fr 1fr"
                gap="2rem"
                margin="2rem 0"
                width="100%"
              >
                {notes.length > 0 ? (
                  notes.map((note) => (
                    <Card
                      key={note.id}
                      padding="1.5rem"
                      borderRadius="medium"
                      variation="elevated"
                    >
                      <Flex direction="column" gap="1rem">
                        <Flex justifyContent="space-between" alignItems="center">
                          <Heading level={3}>{note.name}</Heading>
                          {note.shared && <Badge variation="success">Shared</Badge>}
                        </Flex>
                        <Text>{note.description}</Text>
                        <Text fontWeight="bold">Task: {note.task}</Text>
                        {note.image && (
                          <Image
                            src={note.image}
                            alt={`visual aid for ${note.name}`}
                            style={{ width: "100%", maxHeight: "200px", objectFit: "cover" }}
                          />
                        )}
                        <Button variation="destructive" onClick={() => deleteNote(note)}>
                          Delete Note
                        </Button>
                      </Flex>
                    </Card>
                  ))
                ) : (
                  <Text>No notes found. Create your first note!</Text>
                )}
              </Grid>
            </TabItem>
            
            <TabItem title={`Friends' Notes (${friendsNotes.length})`}>
              <Grid
                templateColumns="1fr 1fr 1fr"
                gap="2rem"
                margin="2rem 0"
                width="100%"
              >
                {friendsNotes.length > 0 ? (
                  friendsNotes.map((note) => (
                    <Card
                      key={note.id}
                      padding="1.5rem"
                      borderRadius="medium"
                      variation="elevated"
                    >
                      <Flex direction="column" gap="1rem">
                        <Flex justifyContent="space-between" alignItems="center">
                          <Heading level={3}>{note.name}</Heading>
                          <Badge variation="info">From: {note.owner}</Badge>
                        </Flex>
                        <Text>{note.description}</Text>
                        <Text fontWeight="bold">Task: {note.task}</Text>
                        {note.image && (
                          <Image
                            src={note.image}
                            alt={`visual aid for ${note.name}`}
                            style={{ width: "100%", maxHeight: "200px", objectFit: "cover" }}
                          />
                        )}
                      </Flex>
                    </Card>
                  ))
                ) : (
                  <Text>No shared notes from friends yet.</Text>
                )}
              </Grid>
            </TabItem>
            
            <TabItem title="Friends">
              <Flex direction="column" gap="2rem" width="100%" margin="2rem 0">
                <Card padding="1.5rem">
                  <Heading level={3}>Add a Friend</Heading>
                  <Flex as="form" gap="1rem" margin="1rem 0" onSubmit={sendFriendRequest}>
                    <TextField
                      name="friendEmail"
                      placeholder="Friend's Email Address"
                      value={friendEmail}
                      onChange={(e) => setFriendEmail(e.target.value)}
                      flex="1"
                      required
                    />
                    <Button type="submit" variation="primary">
                      Send Request
                    </Button>
                  </Flex>
                </Card>
                
                {friendRequests.length > 0 && (
                  <Card padding="1.5rem">
                    <Heading level={3}>Friend Requests</Heading>
                    {friendRequests.map((request) => (
                      <Flex
                        key={request.id}
                        justifyContent="space-between"
                        alignItems="center"
                        padding="1rem"
                        borderBottom="1px solid #eee"
                      >
                        <Text>{request.requesterEmail}</Text>
                        <Flex gap="1rem">
                          <Button
                            variation="primary"
                            onClick={() => handleFriendRequest(request.id, true)}
                          >
                            Accept
                          </Button>
                          <Button
                            variation="destructive"
                            onClick={() => handleFriendRequest(request.id, false)}
                          >
                            Decline
                          </Button>
                        </Flex>
                      </Flex>
                    ))}
                  </Card>
                )}
                
                <Card padding="1.5rem">
                  <Heading level={3}>My Friends</Heading>
                  {friends.length > 0 ? (
                    friends.map((friend) => (
                      <Flex
                        key={friend.id}
                        justifyContent="space-between"
                        alignItems="center"
                        padding="1rem"
                        borderBottom="1px solid #eee"
                      >
                        <Text>{friend.email}</Text>
                        <Button
                          variation="destructive"
                          onClick={() => removeFriend(friend.id)}
                        >
                          Remove
                        </Button>
                      </Flex>
                    ))
                  ) : (
                    <Text padding="1rem">No friends added yet.</Text>
                  )}
                </Card>
              </Flex>
            </TabItem>
          </Tabs>
          
          <Button onClick={signOut} margin="2rem 0">
            Sign Out
          </Button>
        </Flex>
      )}
    </Authenticator>
  );
}